import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RestaurantSnapshot } from '../src/types/domain.ts';
import { createInitialSnapshot } from './seedData.ts';

const dataDir = path.resolve(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'hearthline.db');

const sqlite = new DatabaseSync(dbPath);
sqlite.exec('PRAGMA journal_mode = WAL;');
sqlite.exec('PRAGMA foreign_keys = ON;');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS restaurant_state (
    id TEXT PRIMARY KEY,
    snapshot_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS staff_credentials (
    staff_id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    employee_id TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    staff_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS system_flags (
    flag_key TEXT PRIMARY KEY,
    flag_value TEXT NOT NULL
  );
`);

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hex] = storedHash.split(':');
  if (!salt || !hex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(hex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

export function getSnapshot(): RestaurantSnapshot {
  const row = sqlite
    .prepare('SELECT snapshot_json FROM restaurant_state WHERE id = ?')
    .get('main') as { snapshot_json?: string } | undefined;

  if (!row?.snapshot_json) {
    const initial = createInitialSnapshot();
    saveSnapshot(initial);
    return initial;
  }
  return JSON.parse(row.snapshot_json) as RestaurantSnapshot;
}

export function saveSnapshot(snapshot: RestaurantSnapshot): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO restaurant_state (id, snapshot_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`
    )
    .run('main', JSON.stringify(snapshot), now);
}

export function mutateSnapshot<T>(mutator: (snapshot: RestaurantSnapshot) => T): T {
  sqlite.exec('BEGIN IMMEDIATE;');
  try {
    const current = getSnapshot();
    const result = mutator(current);
    saveSnapshot(current);
    sqlite.exec('COMMIT;');
    return result;
  } catch (error) {
    sqlite.exec('ROLLBACK;');
    throw error;
  }
}

export function isAdminClaimed(): boolean {
  if (process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0) {
    return true;
  }
  const flag = sqlite
    .prepare('SELECT flag_value FROM system_flags WHERE flag_key = ?')
    .get('admin_claimed') as { flag_value?: string } | undefined;
  return flag?.flag_value === 'true';
}

export function claimInitialAdmin(password: string): boolean {
  if (password.length < 6) {
    throw new Error('Admin passcode must be at least 6 characters.');
  }
  sqlite.exec('BEGIN IMMEDIATE;');
  try {
    const existing = sqlite
      .prepare('SELECT flag_value FROM system_flags WHERE flag_key = ?')
      .get('admin_claimed') as { flag_value?: string } | undefined;
    if (existing?.flag_value === 'true') {
      sqlite.exec('ROLLBACK;');
      return false;
    }

    const hash = hashPassword(password);
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO staff_credentials (staff_id, email, employee_id, password_hash, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(staff_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at`
      )
      .run('stf_owner', 'adyanshacademy@gmail.com', 'EMP-001', hash, now);

    // Provision default operational staff credentials using the claimed workspace passcode so manager can also test or change individual passcodes in Staff Management
    const snapshot = getSnapshot();
    for (const member of snapshot.staff) {
      if (member.id === 'stf_owner') continue;
      sqlite
        .prepare(
          `INSERT OR IGNORE INTO staff_credentials (staff_id, email, employee_id, password_hash, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(member.id, member.email.toLowerCase(), member.employeeId.toUpperCase(), hash, now);
    }

    sqlite
      .prepare(
        `INSERT INTO system_flags (flag_key, flag_value)
         VALUES ('admin_claimed', 'true')
         ON CONFLICT(flag_key) DO UPDATE SET flag_value = 'true'`
      )
      .run();

    sqlite.exec('COMMIT;');
    return true;
  } catch (err) {
    sqlite.exec('ROLLBACK;');
    throw err;
  }
}

export function setStaffPassword(staffId: string, email: string, employeeId: string, password: string): void {
  const hash = hashPassword(password);
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO staff_credentials (staff_id, email, employee_id, password_hash, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(staff_id) DO UPDATE SET
         email = excluded.email,
         employee_id = excluded.employee_id,
         password_hash = excluded.password_hash,
         updated_at = excluded.updated_at`
    )
    .run(staffId, email.toLowerCase(), employeeId.toUpperCase(), hash, now);
}

export function verifyStaffCredentials(identifier: string, password: string): string | null {
  const cleanId = identifier.trim().toLowerCase();
  const cleanEmp = identifier.trim().toUpperCase();

  // Check env override for owner/admin
  if (
    process.env.ADMIN_PASSCODE &&
    process.env.ADMIN_PASSCODE.trim().length > 0 &&
    (cleanId === 'adyanshacademy@gmail.com' || cleanEmp === 'EMP-001') &&
    password === process.env.ADMIN_PASSCODE.trim()
  ) {
    return 'stf_owner';
  }

  const row = sqlite
    .prepare(
      `SELECT staff_id, password_hash FROM staff_credentials
       WHERE lower(email) = ? OR upper(employee_id) = ?`
    )
    .get(cleanId, cleanEmp) as { staff_id?: string; password_hash?: string } | undefined;

  if (!row?.staff_id || !row?.password_hash) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return row.staff_id;
}

export function createAuthSession(staffId: string): string {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  sqlite
    .prepare(
      `INSERT INTO auth_sessions (token_hash, staff_id, expires_at, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(tokenHash, staffId, expires.toISOString(), now.toISOString());
  return rawToken;
}

export function resolveAuthSession(rawToken: string): string | null {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const row = sqlite
    .prepare('SELECT staff_id, expires_at FROM auth_sessions WHERE token_hash = ?')
    .get(tokenHash) as { staff_id?: string; expires_at?: string } | undefined;

  if (!row?.staff_id || !row?.expires_at) return null;
  if (Date.now() > new Date(row.expires_at).getTime()) {
    sqlite.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return row.staff_id;
}

export function deleteAuthSession(rawToken: string): void {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  sqlite.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash);
}
