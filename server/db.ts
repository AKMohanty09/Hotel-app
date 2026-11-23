import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RestaurantSnapshot, StaffProfile } from '../src/types/domain.ts';
import { createInitialSnapshot } from './seedData.ts';
import { CORE_TABLES_PG_DDL, CORE_TABLES_SQLITE_DDL } from './schemaSql.ts';
import {
  readMediaAssetFromDb,
  storeMediaAssetInDb,
  syncSnapshotToNormalizedTables,
  type MediaAssetRecord,
  type MediaCategory,
  type StoredMediaBinary,
} from './normalizedSync.ts';

export type StorageBackend = 'postgres' | 'supabase' | 'sqlite';

export function isSupabaseSchemaMissingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return (
    msg.includes('schema cache') ||
    msg.includes('PGRST205') ||
    msg.includes('does not exist') ||
    msg.includes('42P01')
  );
}

export function isSupabaseRlsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return msg.toLowerCase().includes('row-level security') || msg.includes('42501');
}

export function isSupabaseAnonKeyConfigured(): boolean {
  if (getStorageBackend() !== 'supabase') return false;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
  if (!key) return false;
  if (key.startsWith('sb_publishable_')) return true;
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
        role?: string;
      };
      if (payload.role === 'anon') return true;
    } catch {
      // ignore non-JWT keys
    }
  }
  return false;
}

export interface OtpChallengeRecord {
  requestId: string;
  tableId: string;
  otpHash: string;
  otpPlainForWaiterRevealOnly: string;
  salt: string;
  expiresAtMs: number;
  lastSentAtMs: number;
  attempts: number;
  maxAttempts: number;
  used: boolean;
  presenceConfirmed: boolean;
  waiterId?: string;
}

declare global {
  var _shPgPool: Pool | undefined;
  var _shPgSchemaReady: Promise<void> | undefined;
  var _shSupabaseClient: SupabaseClient | undefined;
  var _shSqliteDb: import('node:sqlite').DatabaseSync | undefined;
  var _shSqliteInitPromise: Promise<import('node:sqlite').DatabaseSync> | undefined;
}

function getPostgresConnectionString(): string | undefined {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.SUPABASE_DB_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
  ];
  for (const val of candidates) {
    if (val && val.trim().length > 0) return val.trim();
  }
  return undefined;
}

export function getStorageBackend(): StorageBackend {
  if (
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_URL.trim().length > 0 &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY.trim().length > 0
  ) {
    return 'supabase';
  }
  if (getPostgresConnectionString()) return 'postgres';
  return 'sqlite';
}

function getPgPool(): Pool {
  if (!global._shPgPool) {
    const connStr = getPostgresConnectionString();
    if (!connStr) {
      throw new Error('PostgreSQL connection string is not configured.');
    }
    const isLocal =
      connStr.includes('localhost') ||
      connStr.includes('127.0.0.1') ||
      connStr.includes('sslmode=disable');

    global._shPgPool = new Pool({
      connectionString: connStr,
      max: process.env.VERCEL ? 3 : 10,
      connectionTimeoutMillis: 6000,
      idleTimeoutMillis: 20000,
      ssl: isLocal ? false : { rejectUnauthorized: false },
    });

    global._shPgPool.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err);
    });
  }
  return global._shPgPool;
}

async function ensurePgSchema(): Promise<void> {
  if (!global._shPgSchemaReady) {
    global._shPgSchemaReady = (async () => {
      const pool = getPgPool();
      await pool.query(CORE_TABLES_PG_DDL);
      await pool.query(`
        ALTER TABLE restaurant_reviews ADD COLUMN IF NOT EXISTS table_id TEXT;
        ALTER TABLE restaurant_reviews ADD COLUMN IF NOT EXISTS customer_name TEXT;
        ALTER TABLE restaurant_reviews ADD COLUMN IF NOT EXISTS manager_reply TEXT;
        ALTER TABLE restaurant_reviews ADD COLUMN IF NOT EXISTS replied_by TEXT;
        ALTER TABLE restaurant_reviews ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;
        ALTER TABLE restaurant_reviews ALTER COLUMN session_id DROP NOT NULL;
      `).catch(() => {});
    })().catch((err) => {
      global._shPgSchemaReady = undefined;
      throw err;
    });
  }
  await global._shPgSchemaReady;
}

function getSupabaseClient(): SupabaseClient {
  if (!global._shSupabaseClient) {
    const url = process.env.SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.');
    }
    global._shSupabaseClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return global._shSupabaseClient;
}

export function getPublicSupabaseRealtimeConfig(): {
  enabled: boolean;
  url: string | null;
  anonKey: string | null;
  jwtSigningReady: boolean;
} {
  if (getStorageBackend() !== 'supabase') {
    return { enabled: false, url: null, anonKey: null, jwtSigningReady: false };
  }
  const url = process.env.SUPABASE_URL?.trim() || null;
  const anonKey =
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.VITE_SUPABASE_ANON_KEY?.trim() ||
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
    null;
  const jwtSecret = process.env.SUPABASE_JWT_SECRET?.trim() || '';
  return {
    enabled: Boolean(url && anonKey),
    url,
    anonKey,
    jwtSigningReady: Boolean(url && anonKey && jwtSecret.length >= 16),
  };
}

export function issueScopedRealtimeJwt(claims: {
  app_scope: 'staff' | 'customer';
  staff_id?: string;
  staff_role?: string;
  table_id?: string;
  session_id?: string;
}): { token: string; expiresAt: string } | null {
  const secret = process.env.SUPABASE_JWT_SECRET?.trim();
  if (!secret || secret.length < 16) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + 3600;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadObj: Record<string, unknown> = {
    aud: 'authenticated',
    role: 'authenticated',
    sub: claims.staff_id || (claims.table_id ? `guest_${claims.table_id}` : 'guest'),
    iat: nowSec,
    exp: expSec,
    app_scope: claims.app_scope,
  };
  if (claims.staff_id) payloadObj.staff_id = claims.staff_id;
  if (claims.staff_role) payloadObj.staff_role = claims.staff_role;
  if (claims.table_id) payloadObj.table_id = claims.table_id;
  if (claims.session_id) payloadObj.session_id = claims.session_id;

  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return {
    token: `${header}.${payload}.${signature}`,
    expiresAt: new Date(expSec * 1000).toISOString(),
  };
}

export async function emitSupabaseRealtimeBroadcast(eventPayload: Record<string, unknown>): Promise<void> {
  if (getStorageBackend() !== 'supabase') return;
  try {
    const sb = getSupabaseClient();
    const channels: string[] = ['sh:workspace'];
    const tableId = typeof eventPayload.tableId === 'string' ? eventPayload.tableId : undefined;
    if (tableId) {
      channels.push(`sh:table:${tableId}`);
    }
    await Promise.all(
      channels.map(async (channelName) => {
        const ch = sb.channel(channelName);
        try {
          await ch.httpSend('pos_event', eventPayload);
        } finally {
          await sb.removeChannel(ch).catch(() => {});
        }
      })
    );
  } catch {
    // Non-fatal: WebSocket /ws and client catch-up polling still guarantee delivery
  }
}

async function getSqliteDb(): Promise<import('node:sqlite').DatabaseSync> {
  if (global._shSqliteDb) return global._shSqliteDb;
  if (!global._shSqliteInitPromise) {
    global._shSqliteInitPromise = (async () => {
      const { DatabaseSync } = await import('node:sqlite');
      const baseDir = process.env.VERCEL ? '/tmp/hearthline-data' : path.resolve(process.cwd(), 'data');
      fs.mkdirSync(baseDir, { recursive: true });
      const dbPath = path.join(baseDir, 'hearthline.db');
      const sqlite = new DatabaseSync(dbPath);
      sqlite.exec('PRAGMA journal_mode = WAL;');
      sqlite.exec('PRAGMA foreign_keys = ON;');
      sqlite.exec(CORE_TABLES_SQLITE_DDL);
      const reviewCols = sqlite.prepare('PRAGMA table_info(restaurant_reviews)').all() as {
        name: string;
        notnull: number;
      }[];
      const existingReviewCols = new Set(reviewCols.map((c) => c.name));
      const sessionCol = reviewCols.find((c) => c.name === 'session_id');
      const needsReviewRebuild =
        (sessionCol && sessionCol.notnull === 1) ||
        !existingReviewCols.has('table_id') ||
        !existingReviewCols.has('customer_name') ||
        !existingReviewCols.has('manager_reply') ||
        !existingReviewCols.has('replied_by') ||
        !existingReviewCols.has('replied_at');
      if (needsReviewRebuild) {
        sqlite.exec(`
          CREATE TABLE IF NOT EXISTS restaurant_reviews_migrated (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            table_id TEXT,
            table_number TEXT NOT NULL,
            customer_name TEXT,
            overall_rating INTEGER NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
            food_rating INTEGER NOT NULL CHECK (food_rating BETWEEN 1 AND 5),
            service_rating INTEGER NOT NULL CHECK (service_rating BETWEEN 1 AND 5),
            comment TEXT,
            manager_reply TEXT,
            replied_by TEXT,
            replied_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT OR IGNORE INTO restaurant_reviews_migrated (
            id, session_id, table_number, overall_rating, food_rating, service_rating, comment, created_at
          )
          SELECT id, session_id, table_number, overall_rating, food_rating, service_rating, comment, created_at
          FROM restaurant_reviews;
          DROP TABLE restaurant_reviews;
          ALTER TABLE restaurant_reviews_migrated RENAME TO restaurant_reviews;
          CREATE INDEX IF NOT EXISTS idx_restaurant_reviews_created_at ON restaurant_reviews (created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_restaurant_reviews_session_id ON restaurant_reviews (session_id);
        `);
      }
      global._shSqliteDb = sqlite;
      return sqlite;
    })();
  }
  return global._shSqliteInitPromise;
}

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

export async function getSnapshot(): Promise<RestaurantSnapshot> {
  const backend = getStorageBackend();

  if (backend === 'postgres') {
    await ensurePgSchema();
    const pool = getPgPool();
    const { rows } = await pool.query<{ snapshot_json: string }>(
      'SELECT snapshot_json FROM restaurant_state WHERE id = $1',
      ['main']
    );
    if (!rows[0]?.snapshot_json) {
      return createInitialSnapshot();
    }
    return JSON.parse(rows[0].snapshot_json) as RestaurantSnapshot;
  }

  if (backend === 'supabase') {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('restaurant_state')
      .select('snapshot_json')
      .eq('id', 'main')
      .maybeSingle();
    if (error) {
      throw new Error(`Supabase state read failed: ${error.message}`);
    }
    if (!data?.snapshot_json) {
      return createInitialSnapshot();
    }
    return JSON.parse(String(data.snapshot_json)) as RestaurantSnapshot;
  }

  const sqlite = await getSqliteDb();
  const row = sqlite
    .prepare('SELECT snapshot_json FROM restaurant_state WHERE id = ?')
    .get('main') as { snapshot_json?: string } | undefined;

  if (!row?.snapshot_json) {
    return createInitialSnapshot();
  }
  return JSON.parse(row.snapshot_json) as RestaurantSnapshot;
}

export async function isFullSupabaseSchemaReady(): Promise<boolean> {
  if (getStorageBackend() !== 'supabase') return true;
  const sb = getSupabaseClient();
  const [settingsCheck, mediaCheck] = await Promise.all([
    sb.from('restaurant_settings').select('id').limit(1),
    sb.from('media_assets').select('id').limit(1),
  ]);
  if (settingsCheck.error && isSupabaseSchemaMissingError(settingsCheck.error)) return false;
  if (mediaCheck.error && isSupabaseSchemaMissingError(mediaCheck.error)) return false;
  return true;
}

export async function saveUploadedMedia(params: {
  category: MediaCategory;
  entityId?: string;
  fileName?: string;
  mimeType: string;
  base64Data: string;
  uploadedByStaffId?: string;
}): Promise<MediaAssetRecord> {
  const backend = getStorageBackend();
  if (backend === 'postgres') {
    await ensurePgSchema();
    return storeMediaAssetInDb({ backend, pgPool: getPgPool(), ...params });
  }
  if (backend === 'supabase') {
    return storeMediaAssetInDb({ backend, supabase: getSupabaseClient(), ...params });
  }
  const sqlite = await getSqliteDb();
  return storeMediaAssetInDb({ backend, sqlite, ...params });
}

export async function getUploadedMedia(id: string): Promise<StoredMediaBinary | null> {
  const backend = getStorageBackend();
  if (backend === 'postgres') {
    await ensurePgSchema();
    return readMediaAssetFromDb({ backend, pgPool: getPgPool(), id });
  }
  if (backend === 'supabase') {
    return readMediaAssetFromDb({ backend, supabase: getSupabaseClient(), id });
  }
  const sqlite = await getSqliteDb();
  return readMediaAssetFromDb({ backend, sqlite, id });
}

export async function saveSnapshot(
  snapshot: RestaurantSnapshot,
  previousSnapshot?: RestaurantSnapshot | null
): Promise<void> {
  const now = new Date().toISOString();
  const json = JSON.stringify(snapshot);
  const backend = getStorageBackend();

  if (backend === 'postgres') {
    await ensurePgSchema();
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO restaurant_state (id, snapshot_json, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`,
      ['main', json, now]
    );
    await syncSnapshotToNormalizedTables({
      backend,
      pgPool: pool,
      next: snapshot,
      prev: previousSnapshot,
    });
    return;
  }

  if (backend === 'supabase') {
    const sb = getSupabaseClient();
    const { error } = await sb.from('restaurant_state').upsert(
      { id: 'main', snapshot_json: json, updated_at: now },
      { onConflict: 'id' }
    );
    if (error) {
      throw new Error(`Supabase state save failed: ${error.message}`);
    }
    await syncSnapshotToNormalizedTables({
      backend,
      supabase: sb,
      next: snapshot,
      prev: previousSnapshot,
    });
    return;
  }

  const sqlite = await getSqliteDb();
  sqlite
    .prepare(
      `INSERT INTO restaurant_state (id, snapshot_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`
    )
    .run('main', json, now);
  await syncSnapshotToNormalizedTables({
    backend,
    sqlite,
    next: snapshot,
    prev: previousSnapshot,
  });
}

export async function mutateSnapshot<T>(mutator: (snapshot: RestaurantSnapshot) => T | Promise<T>): Promise<T> {
  const backend = getStorageBackend();

  if (backend === 'postgres') {
    await ensurePgSchema();
    const pool = getPgPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ snapshot_json: string }>(
        'SELECT snapshot_json FROM restaurant_state WHERE id = $1 FOR UPDATE',
        ['main']
      );
      let current: RestaurantSnapshot;
      if (!rows[0]?.snapshot_json) {
        current = createInitialSnapshot();
      } else {
        current = JSON.parse(rows[0].snapshot_json) as RestaurantSnapshot;
      }
      const before = structuredClone(current);
      const result = await mutator(current);
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO restaurant_state (id, snapshot_json, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`,
        ['main', JSON.stringify(current), now]
      );
      await client.query('COMMIT');
      await syncSnapshotToNormalizedTables({
        backend,
        pgPool: pool,
        next: current,
        prev: before,
      });
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  if (backend === 'supabase') {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('restaurant_state')
      .select('snapshot_json, updated_at')
      .eq('id', 'main')
      .maybeSingle();
    if (error) throw new Error(`Supabase read failed: ${error.message}`);

    const current = data?.snapshot_json
      ? (JSON.parse(String(data.snapshot_json)) as RestaurantSnapshot)
      : createInitialSnapshot();
    const before = structuredClone(current);

    const result = await mutator(current);
    await saveSnapshot(current, before);
    return result;
  }

  const sqlite = await getSqliteDb();
  sqlite.exec('BEGIN IMMEDIATE;');
  try {
    const row = sqlite
      .prepare('SELECT snapshot_json FROM restaurant_state WHERE id = ?')
      .get('main') as { snapshot_json?: string } | undefined;
    const current = row?.snapshot_json
      ? (JSON.parse(row.snapshot_json) as RestaurantSnapshot)
      : createInitialSnapshot();
    const before = structuredClone(current);
    const result = await mutator(current);
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO restaurant_state (id, snapshot_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`
      )
      .run('main', JSON.stringify(current), now);
    sqlite.exec('COMMIT;');
    await syncSnapshotToNormalizedTables({
      backend,
      sqlite,
      next: current,
      prev: before,
    });
    return result;
  } catch (error) {
    sqlite.exec('ROLLBACK;');
    throw error;
  }
}

export interface RegisterOwnerInput {
  restaurantName: string;
  ownerName: string;
  email: string;
  mobile?: string;
  photoUrl?: string;
  passcode: string;
}

export async function isAdminClaimed(): Promise<boolean> {
  const backend = getStorageBackend();

  if (backend === 'postgres') {
    await ensurePgSchema();
    const { rows } = await getPgPool().query<{ flag_value: string }>(
      'SELECT flag_value FROM system_flags WHERE flag_key = $1',
      ['admin_claimed']
    );
    if (rows[0]?.flag_value === 'true') return true;
  } else if (backend === 'supabase') {
    const { data, error } = await getSupabaseClient()
      .from('system_flags')
      .select('flag_value')
      .eq('flag_key', 'admin_claimed')
      .maybeSingle();
    if (error) throw new Error(`Supabase flag read failed: ${error.message}`);
    if (data?.flag_value === 'true') return true;
  } else {
    const sqlite = await getSqliteDb();
    const flag = sqlite
      .prepare('SELECT flag_value FROM system_flags WHERE flag_key = ?')
      .get('admin_claimed') as { flag_value?: string } | undefined;
    if (flag?.flag_value === 'true') return true;
  }

  return false;
}

export async function registerInitialOwner(
  input: RegisterOwnerInput
): Promise<{ ok: true; owner: StaffProfile } | { ok: false }> {
  const restaurantName = input.restaurantName.trim();
  const ownerName = input.ownerName.trim();
  const ownerEmail = input.email.trim().toLowerCase();
  const ownerMobile = input.mobile?.trim() || '';
  const passcode = input.passcode.trim();

  if (restaurantName.length < 2) {
    throw new Error('Restaurant name must be at least 2 characters.');
  }
  if (ownerName.length < 2) {
    throw new Error('Owner full name must be at least 2 characters.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    throw new Error('Please enter a valid owner email address.');
  }
  if (passcode.length < 6) {
    throw new Error('Passcode must be at least 6 characters.');
  }

  if (await isAdminClaimed()) {
    return { ok: false };
  }

  const now = new Date().toISOString();
  const ownerId = 'stf_owner';
  const ownerEmpId = 'EMP-001';
  const ownerProfile: StaffProfile = {
    id: ownerId,
    uid: ownerId,
    employeeId: ownerEmpId,
    name: ownerName,
    email: ownerEmail,
    mobile: ownerMobile,
    photoUrl: input.photoUrl?.trim() || undefined,
    role: 'owner',
    section: 'All Floors',
    assignedTableIds: [],
    shift: 'Full Day',
    joinDate: now.slice(0, 10),
    status: 'active',
    onDuty: true,
    createdAt: now,
    updatedAt: now,
  };

  const snapshot = createInitialSnapshot({
    restaurantName,
    ownerEmail,
    ownerPhone: ownerMobile,
  });
  snapshot.staff = [ownerProfile];
  snapshot.auditLogs = [
    {
      id: `aud_${crypto.randomUUID().slice(0, 12)}`,
      actorId: ownerProfile.id,
      actorName: ownerProfile.name,
      actorRole: ownerProfile.role,
      action: 'OWNER_REGISTERED',
      entityType: 'staff',
      recordId: ownerProfile.id,
      metadata: { restaurantName, email: ownerEmail },
      createdAt: now,
    },
  ];

  const hash = hashPassword(passcode);
  const backend = getStorageBackend();

  if (backend === 'postgres') {
    await ensurePgSchema();
    const client = await getPgPool().connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ flag_value: string }>(
        'SELECT flag_value FROM system_flags WHERE flag_key = $1 FOR UPDATE',
        ['admin_claimed']
      );
      if (existing.rows[0]?.flag_value === 'true') {
        await client.query('ROLLBACK');
        return { ok: false };
      }

      await client.query(
        `INSERT INTO restaurant_state (id, snapshot_json, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`,
        ['main', JSON.stringify(snapshot), now]
      );

      await client.query(
        `INSERT INTO staff_credentials (staff_id, email, employee_id, password_hash, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT(staff_id) DO UPDATE SET email = excluded.email, employee_id = excluded.employee_id, password_hash = excluded.password_hash, updated_at = excluded.updated_at`,
        [ownerId, ownerEmail, ownerEmpId, hash, now]
      );

      await client.query(
        `INSERT INTO system_flags (flag_key, flag_value)
         VALUES ('admin_claimed', 'true')
         ON CONFLICT(flag_key) DO UPDATE SET flag_value = 'true'`
      );
      await client.query('COMMIT');
      await syncSnapshotToNormalizedTables({
        backend,
        pgPool: getPgPool(),
        next: snapshot,
        prev: null,
      });
      return { ok: true, owner: ownerProfile };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  if (backend === 'supabase') {
    const sb = getSupabaseClient();
    const { data: existingFlag, error: readFlagErr } = await sb
      .from('system_flags')
      .select('flag_value')
      .eq('flag_key', 'admin_claimed')
      .maybeSingle();
    if (readFlagErr) throw new Error(`Supabase flag check failed: ${readFlagErr.message}`);
    if (existingFlag?.flag_value === 'true') return { ok: false };

    const { error: stateErr } = await sb.from('restaurant_state').upsert(
      { id: 'main', snapshot_json: JSON.stringify(snapshot), updated_at: now },
      { onConflict: 'id' }
    );
    if (stateErr) throw new Error(`Supabase workspace save failed: ${stateErr.message}`);

    const { error: credErr } = await sb.from('staff_credentials').upsert(
      {
        staff_id: ownerId,
        email: ownerEmail,
        employee_id: ownerEmpId,
        password_hash: hash,
        updated_at: now,
      },
      { onConflict: 'staff_id' }
    );
    if (credErr) throw new Error(`Supabase credential save failed: ${credErr.message}`);

    const { error: flagErr } = await sb
      .from('system_flags')
      .upsert({ flag_key: 'admin_claimed', flag_value: 'true' }, { onConflict: 'flag_key' });
    if (flagErr) throw new Error(`Supabase flag save failed: ${flagErr.message}`);

    await syncSnapshotToNormalizedTables({
      backend,
      supabase: sb,
      next: snapshot,
      prev: null,
    });
    return { ok: true, owner: ownerProfile };
  }

  const sqlite = await getSqliteDb();
  sqlite.exec('BEGIN IMMEDIATE;');
  try {
    const existing = sqlite
      .prepare('SELECT flag_value FROM system_flags WHERE flag_key = ?')
      .get('admin_claimed') as { flag_value?: string } | undefined;
    if (existing?.flag_value === 'true') {
      sqlite.exec('ROLLBACK;');
      return { ok: false };
    }

    sqlite
      .prepare(
        `INSERT INTO restaurant_state (id, snapshot_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`
      )
      .run('main', JSON.stringify(snapshot), now);

    sqlite
      .prepare(
        `INSERT INTO staff_credentials (staff_id, email, employee_id, password_hash, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(staff_id) DO UPDATE SET email = excluded.email, employee_id = excluded.employee_id, password_hash = excluded.password_hash, updated_at = excluded.updated_at`
      )
      .run(ownerId, ownerEmail, ownerEmpId, hash, now);

    sqlite
      .prepare(
        `INSERT INTO system_flags (flag_key, flag_value)
         VALUES ('admin_claimed', 'true')
         ON CONFLICT(flag_key) DO UPDATE SET flag_value = 'true'`
      )
      .run();

    sqlite.exec('COMMIT;');
    await syncSnapshotToNormalizedTables({
      backend,
      sqlite,
      next: snapshot,
      prev: null,
    });
    return { ok: true, owner: ownerProfile };
  } catch (err) {
    sqlite.exec('ROLLBACK;');
    throw err;
  }
}

export async function setStaffPassword(
  staffId: string,
  email: string,
  employeeId: string,
  password: string
): Promise<void> {
  const hash = hashPassword(password);
  const now = new Date().toISOString();
  const cleanEmail = email.trim().toLowerCase();
  const cleanEmp = employeeId.trim().toUpperCase();
  const backend = getStorageBackend();

  if (backend === 'postgres') {
    await ensurePgSchema();
    await getPgPool().query(
      `INSERT INTO staff_credentials (staff_id, email, employee_id, password_hash, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(staff_id) DO UPDATE SET
         email = excluded.email,
         employee_id = excluded.employee_id,
         password_hash = excluded.password_hash,
         updated_at = excluded.updated_at`,
      [staffId, cleanEmail, cleanEmp, hash, now]
    );
    return;
  }

  if (backend === 'supabase') {
    const { error } = await getSupabaseClient().from('staff_credentials').upsert(
      {
        staff_id: staffId,
        email: cleanEmail,
        employee_id: cleanEmp,
        password_hash: hash,
        updated_at: now,
      },
      { onConflict: 'staff_id' }
    );
    if (error) throw new Error(`Supabase password update failed: ${error.message}`);
    return;
  }

  const sqlite = await getSqliteDb();
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
    .run(staffId, cleanEmail, cleanEmp, hash, now);
}

export async function updateStaffCredentialEmail(
  staffId: string,
  newEmail: string,
  employeeId: string
): Promise<void> {
  const now = new Date().toISOString();
  const cleanEmail = newEmail.trim().toLowerCase();
  const cleanEmp = employeeId.trim().toUpperCase();
  const backend = getStorageBackend();

  if (backend === 'postgres') {
    await ensurePgSchema();
    await getPgPool().query(
      `UPDATE staff_credentials SET email = $1, employee_id = $2, updated_at = $3 WHERE staff_id = $4`,
      [cleanEmail, cleanEmp, now, staffId]
    );
    return;
  }

  if (backend === 'supabase') {
    const { error } = await getSupabaseClient()
      .from('staff_credentials')
      .update({ email: cleanEmail, employee_id: cleanEmp, updated_at: now })
      .eq('staff_id', staffId);
    if (error) throw new Error(`Supabase email sync failed: ${error.message}`);
    return;
  }

  const sqlite = await getSqliteDb();
  sqlite
    .prepare(
      `UPDATE staff_credentials SET email = ?, employee_id = ?, updated_at = ? WHERE staff_id = ?`
    )
    .run(cleanEmail, cleanEmp, now, staffId);
}

export async function verifyStaffCredentials(identifier: string, password: string): Promise<string | null> {
  const cleanId = identifier.trim().toLowerCase();
  const cleanEmp = identifier.trim().toUpperCase();

  // Check env override for owner/admin using registered owner email or employeeId
  if (process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0) {
    const snap = await getSnapshot();
    const owner = snap.staff.find((s) => s.id === 'stf_owner' || s.role === 'owner');
    if (owner) {
      const ownerEmail = owner.email.toLowerCase();
      const ownerEmpId = owner.employeeId.toUpperCase();
      if (
        (cleanId === ownerEmail || cleanEmp === ownerEmpId) &&
        password === process.env.ADMIN_PASSCODE.trim()
      ) {
        return owner.id;
      }
    }
  }

  const backend = getStorageBackend();

  if (backend === 'postgres') {
    await ensurePgSchema();
    const { rows } = await getPgPool().query<{ staff_id: string; password_hash: string }>(
      `SELECT staff_id, password_hash FROM staff_credentials
       WHERE lower(email) = $1 OR upper(employee_id) = $2`,
      [cleanId, cleanEmp]
    );
    const row = rows[0];
    if (!row?.staff_id || !row?.password_hash) return null;
    return verifyPassword(password, row.password_hash) ? row.staff_id : null;
  }

  if (backend === 'supabase') {
    const sb = getSupabaseClient();
    const byEmail = await sb
      .from('staff_credentials')
      .select('staff_id, password_hash')
      .eq('email', cleanId)
      .maybeSingle();
    if (byEmail.error) throw new Error(`Supabase auth lookup failed: ${byEmail.error.message}`);

    let credRow = byEmail.data;
    if (!credRow) {
      const byEmp = await sb
        .from('staff_credentials')
        .select('staff_id, password_hash')
        .eq('employee_id', cleanEmp)
        .maybeSingle();
      if (byEmp.error) throw new Error(`Supabase auth lookup failed: ${byEmp.error.message}`);
      credRow = byEmp.data;
    }

    if (!credRow?.staff_id || !credRow?.password_hash) return null;
    return verifyPassword(password, String(credRow.password_hash)) ? String(credRow.staff_id) : null;
  }

  const sqlite = await getSqliteDb();
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

export async function createAuthSession(staffId: string): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const backend = getStorageBackend();

  if (backend === 'postgres') {
    await ensurePgSchema();
    await getPgPool().query(
      `INSERT INTO auth_sessions (token_hash, staff_id, expires_at, created_at)
       VALUES ($1, $2, $3, $4)`,
      [tokenHash, staffId, expires.toISOString(), now.toISOString()]
    );
    return rawToken;
  }

  if (backend === 'supabase') {
    const { error } = await getSupabaseClient().from('auth_sessions').insert({
      token_hash: tokenHash,
      staff_id: staffId,
      expires_at: expires.toISOString(),
      created_at: now.toISOString(),
    });
    if (error) throw new Error(`Supabase session insert failed: ${error.message}`);
    return rawToken;
  }

  const sqlite = await getSqliteDb();
  sqlite
    .prepare(
      `INSERT INTO auth_sessions (token_hash, staff_id, expires_at, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(tokenHash, staffId, expires.toISOString(), now.toISOString());
  return rawToken;
}

export async function resolveAuthSession(rawToken: string): Promise<string | null> {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const backend = getStorageBackend();

  if (backend === 'postgres') {
    await ensurePgSchema();
    const pool = getPgPool();
    const { rows } = await pool.query<{ staff_id: string; expires_at: string }>(
      'SELECT staff_id, expires_at FROM auth_sessions WHERE token_hash = $1',
      [tokenHash]
    );
    const row = rows[0];
    if (!row?.staff_id || !row?.expires_at) return null;
    if (Date.now() > new Date(row.expires_at).getTime()) {
      await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [tokenHash]);
      return null;
    }
    return row.staff_id;
  }

  if (backend === 'supabase') {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('auth_sessions')
      .select('staff_id, expires_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (error || !data?.staff_id || !data?.expires_at) return null;
    if (Date.now() > new Date(String(data.expires_at)).getTime()) {
      await sb.from('auth_sessions').delete().eq('token_hash', tokenHash);
      return null;
    }
    return String(data.staff_id);
  }

  const sqlite = await getSqliteDb();
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

export async function deleteAuthSession(rawToken: string): Promise<void> {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const backend = getStorageBackend();

  if (backend === 'postgres') {
    await ensurePgSchema();
    await getPgPool().query('DELETE FROM auth_sessions WHERE token_hash = $1', [tokenHash]);
    return;
  }

  if (backend === 'supabase') {
    await getSupabaseClient().from('auth_sessions').delete().eq('token_hash', tokenHash);
    return;
  }

  const sqlite = await getSqliteDb();
  sqlite.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash);
}

// Persistent OTP Challenge & Rate Limit Helpers (Serverless-safe across Vercel invocations)

export async function getOtpChallenge(requestId: string): Promise<OtpChallengeRecord | null> {
  const backend = getStorageBackend();

  if (backend === 'postgres') {
    await ensurePgSchema();
    const { rows } = await getPgPool().query<{
      request_id: string;
      table_id: string;
      otp_hash: string;
      otp_plain_for_waiter_reveal_only: string;
      salt: string;
      expires_at_ms: string | number;
      last_sent_at_ms: string | number;
      attempts: number;
      max_attempts: number;
      used: boolean;
      presence_confirmed: boolean;
      waiter_id: string | null;
    }>('SELECT * FROM otp_challenges WHERE request_id = $1', [requestId]);
    const r = rows[0];
    if (!r) return null;
    return {
      requestId: r.request_id,
      tableId: r.table_id,
      otpHash: r.otp_hash,
      otpPlainForWaiterRevealOnly: r.otp_plain_for_waiter_reveal_only,
      salt: r.salt,
      expiresAtMs: Number(r.expires_at_ms),
      lastSentAtMs: Number(r.last_sent_at_ms),
      attempts: Number(r.attempts),
      maxAttempts: Number(r.max_attempts),
      used: Boolean(r.used),
      presenceConfirmed: Boolean(r.presence_confirmed),
      waiterId: r.waiter_id || undefined,
    };
  }

  if (backend === 'supabase') {
    const { data, error } = await getSupabaseClient()
      .from('otp_challenges')
      .select('*')
      .eq('request_id', requestId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      requestId: String(data.request_id),
      tableId: String(data.table_id),
      otpHash: String(data.otp_hash),
      otpPlainForWaiterRevealOnly: String(data.otp_plain_for_waiter_reveal_only),
      salt: String(data.salt),
      expiresAtMs: Number(data.expires_at_ms),
      lastSentAtMs: Number(data.last_sent_at_ms),
      attempts: Number(data.attempts),
      maxAttempts: Number(data.max_attempts),
      used: Boolean(data.used),
      presenceConfirmed: Boolean(data.presence_confirmed),
      waiterId: data.waiter_id ? String(data.waiter_id) : undefined,
    };
  }

  const sqlite = await getSqliteDb();
  const r = sqlite
    .prepare('SELECT * FROM otp_challenges WHERE request_id = ?')
    .get(requestId) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    requestId: String(r.request_id),
    tableId: String(r.table_id),
    otpHash: String(r.otp_hash),
    otpPlainForWaiterRevealOnly: String(r.otp_plain_for_waiter_reveal_only),
    salt: String(r.salt),
    expiresAtMs: Number(r.expires_at_ms),
    lastSentAtMs: Number(r.last_sent_at_ms),
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    used: Boolean(r.used),
    presenceConfirmed: Boolean(r.presence_confirmed),
    waiterId: r.waiter_id ? String(r.waiter_id) : undefined,
  };
}

export async function saveOtpChallenge(rec: OtpChallengeRecord): Promise<void> {
  const backend = getStorageBackend();

  if (backend === 'postgres') {
    await ensurePgSchema();
    await getPgPool().query(
      `INSERT INTO otp_challenges (
         request_id, table_id, otp_hash, otp_plain_for_waiter_reveal_only, salt,
         expires_at_ms, last_sent_at_ms, attempts, max_attempts, used, presence_confirmed, waiter_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(request_id) DO UPDATE SET
         table_id = excluded.table_id,
         otp_hash = excluded.otp_hash,
         otp_plain_for_waiter_reveal_only = excluded.otp_plain_for_waiter_reveal_only,
         salt = excluded.salt,
         expires_at_ms = excluded.expires_at_ms,
         last_sent_at_ms = excluded.last_sent_at_ms,
         attempts = excluded.attempts,
         max_attempts = excluded.max_attempts,
         used = excluded.used,
         presence_confirmed = excluded.presence_confirmed,
         waiter_id = excluded.waiter_id`,
      [
        rec.requestId,
        rec.tableId,
        rec.otpHash,
        rec.otpPlainForWaiterRevealOnly,
        rec.salt,
        rec.expiresAtMs,
        rec.lastSentAtMs,
        rec.attempts,
        rec.maxAttempts,
        rec.used,
        rec.presenceConfirmed,
        rec.waiterId || null,
      ]
    );
    return;
  }

  if (backend === 'supabase') {
    const { error } = await getSupabaseClient().from('otp_challenges').upsert(
      {
        request_id: rec.requestId,
        table_id: rec.tableId,
        otp_hash: rec.otpHash,
        otp_plain_for_waiter_reveal_only: rec.otpPlainForWaiterRevealOnly,
        salt: rec.salt,
        expires_at_ms: rec.expiresAtMs,
        last_sent_at_ms: rec.lastSentAtMs,
        attempts: rec.attempts,
        max_attempts: rec.maxAttempts,
        used: rec.used,
        presence_confirmed: rec.presenceConfirmed,
        waiter_id: rec.waiterId || null,
      },
      { onConflict: 'request_id' }
    );
    if (error) throw new Error(`Supabase OTP save failed: ${error.message}`);
    return;
  }

  const sqlite = await getSqliteDb();
  sqlite
    .prepare(
      `INSERT INTO otp_challenges (
         request_id, table_id, otp_hash, otp_plain_for_waiter_reveal_only, salt,
         expires_at_ms, last_sent_at_ms, attempts, max_attempts, used, presence_confirmed, waiter_id
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(request_id) DO UPDATE SET
         table_id = excluded.table_id,
         otp_hash = excluded.otp_hash,
         otp_plain_for_waiter_reveal_only = excluded.otp_plain_for_waiter_reveal_only,
         salt = excluded.salt,
         expires_at_ms = excluded.expires_at_ms,
         last_sent_at_ms = excluded.last_sent_at_ms,
         attempts = excluded.attempts,
         max_attempts = excluded.max_attempts,
         used = excluded.used,
         presence_confirmed = excluded.presence_confirmed,
         waiter_id = excluded.waiter_id`
    )
    .run(
      rec.requestId,
      rec.tableId,
      rec.otpHash,
      rec.otpPlainForWaiterRevealOnly,
      rec.salt,
      rec.expiresAtMs,
      rec.lastSentAtMs,
      rec.attempts,
      rec.maxAttempts,
      rec.used ? 1 : 0,
      rec.presenceConfirmed ? 1 : 0,
      rec.waiterId || null
    );
}

export async function deleteOtpChallenge(requestId: string): Promise<void> {
  const backend = getStorageBackend();

  if (backend === 'postgres') {
    await ensurePgSchema();
    await getPgPool().query('DELETE FROM otp_challenges WHERE request_id = $1', [requestId]);
    return;
  }

  if (backend === 'supabase') {
    await getSupabaseClient().from('otp_challenges').delete().eq('request_id', requestId);
    return;
  }

  const sqlite = await getSqliteDb();
  sqlite.prepare('DELETE FROM otp_challenges WHERE request_id = ?').run(requestId);
}

export async function getOtpTableRateTimestamps(tableId: string): Promise<number[]> {
  const backend = getStorageBackend();

  if (backend === 'postgres') {
    await ensurePgSchema();
    const { rows } = await getPgPool().query<{ timestamps_json: string }>(
      'SELECT timestamps_json FROM otp_rate_limits WHERE table_id = $1',
      [tableId]
    );
    if (!rows[0]?.timestamps_json) return [];
    return JSON.parse(rows[0].timestamps_json) as number[];
  }

  if (backend === 'supabase') {
    const { data } = await getSupabaseClient()
      .from('otp_rate_limits')
      .select('timestamps_json')
      .eq('table_id', tableId)
      .maybeSingle();
    if (!data?.timestamps_json) return [];
    return JSON.parse(String(data.timestamps_json)) as number[];
  }

  const sqlite = await getSqliteDb();
  const row = sqlite
    .prepare('SELECT timestamps_json FROM otp_rate_limits WHERE table_id = ?')
    .get(tableId) as { timestamps_json?: string } | undefined;
  if (!row?.timestamps_json) return [];
  return JSON.parse(row.timestamps_json) as number[];
}

export async function saveOtpTableRateTimestamps(tableId: string, timestamps: number[]): Promise<void> {
  const json = JSON.stringify(timestamps);
  const backend = getStorageBackend();

  if (backend === 'postgres') {
    await ensurePgSchema();
    await getPgPool().query(
      `INSERT INTO otp_rate_limits (table_id, timestamps_json)
       VALUES ($1, $2)
       ON CONFLICT(table_id) DO UPDATE SET timestamps_json = excluded.timestamps_json`,
      [tableId, json]
    );
    return;
  }

  if (backend === 'supabase') {
    await getSupabaseClient()
      .from('otp_rate_limits')
      .upsert({ table_id: tableId, timestamps_json: json }, { onConflict: 'table_id' });
    return;
  }

  const sqlite = await getSqliteDb();
  sqlite
    .prepare(
      `INSERT INTO otp_rate_limits (table_id, timestamps_json)
       VALUES (?, ?)
       ON CONFLICT(table_id) DO UPDATE SET timestamps_json = excluded.timestamps_json`
    )
    .run(tableId, json);
}
