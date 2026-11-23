import crypto from 'node:crypto';
import { canResendOtp, evaluateOtpChallenge } from '../src/lib/otpRules.ts';

interface OtpSecretRecord {
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

const otpStore = new Map<string, OtpSecretRecord>();
const tableRateLimit = new Map<string, number[]>();

function hashOtp(otp: string, salt: string): string {
  return crypto.createHash('sha256').update(`${salt}:${otp}`).digest('hex');
}

export function issueOtpForRequest(params: {
  requestId: string;
  tableId: string;
  expirySeconds: number;
  cooldownSeconds: number;
  maxAttempts: number;
  isResend?: boolean;
}): { ok: true; expiresAt: string } | { ok: false; error: string; retryAfterSeconds?: number } {
  const now = Date.now();

  // Rate-limit: max 5 requests per table in 10 minutes
  const windowMs = 10 * 60 * 1000;
  const recent = (tableRateLimit.get(params.tableId) || []).filter((t) => now - t < windowMs);
  if (recent.length >= 8) {
    return {
      ok: false,
      error: 'Too many verification requests for this table. Please ask your waiter for assistance.',
      retryAfterSeconds: 60,
    };
  }

  const existing = otpStore.get(params.requestId);
  if (existing && params.isResend) {
    const resendCheck = canResendOtp(existing.lastSentAtMs, now, params.cooldownSeconds);
    if (!resendCheck.allowed) {
      return {
        ok: false,
        error: `Please wait ${resendCheck.waitSeconds}s before requesting another verification code.`,
        retryAfterSeconds: resendCheck.waitSeconds,
      };
    }
  }

  // Generate secure 4-digit OTP (1000-9999)
  const otp = String(crypto.randomInt(1000, 10000));
  const salt = crypto.randomBytes(16).toString('hex');
  const expiresAtMs = now + params.expirySeconds * 1000;

  otpStore.set(params.requestId, {
    requestId: params.requestId,
    tableId: params.tableId,
    otpHash: hashOtp(otp, salt),
    otpPlainForWaiterRevealOnly: otp,
    salt,
    expiresAtMs,
    lastSentAtMs: now,
    attempts: 0,
    maxAttempts: params.maxAttempts,
    used: false,
    presenceConfirmed: existing?.presenceConfirmed ?? false,
    waiterId: existing?.waiterId,
  });

  recent.push(now);
  tableRateLimit.set(params.tableId, recent);

  return {
    ok: true,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function confirmPresenceAndRevealOtp(
  requestId: string,
  waiterId: string
): { ok: true; otp: string; expiresAt: string } | { ok: false; error: string } {
  const record = otpStore.get(requestId);
  if (!record) {
    return { ok: false, error: 'Verification request not found or expired on server.' };
  }
  if (record.used) {
    return { ok: false, error: 'This verification request has already been completed.' };
  }
  if (Date.now() > record.expiresAtMs) {
    return { ok: false, error: 'This verification request has expired. Ask the guest to tap Resend.' };
  }

  record.presenceConfirmed = true;
  record.waiterId = waiterId;
  return {
    ok: true,
    otp: record.otpPlainForWaiterRevealOnly,
    expiresAt: new Date(record.expiresAtMs).toISOString(),
  };
}

export function verifyOtpSubmission(
  requestId: string,
  submittedOtp: string
): { ok: true } | { ok: false; error: string; remainingAttempts: number } {
  const record = otpStore.get(requestId);
  if (!record) {
    return {
      ok: false,
      error: 'Verification challenge not found or expired. Please request a new code.',
      remainingAttempts: 0,
    };
  }

  const now = Date.now();
  const submittedHash = hashOtp(submittedOtp.trim(), record.salt);
  const isMatch = crypto.timingSafeEqual(
    Buffer.from(submittedHash, 'hex'),
    Buffer.from(record.otpHash, 'hex')
  );

  const evalResult = evaluateOtpChallenge(
    {
      expiresAtMs: record.expiresAtMs,
      lastSentAtMs: record.lastSentAtMs,
      attempts: record.attempts,
      maxAttempts: record.maxAttempts,
      used: record.used,
      presenceConfirmed: record.presenceConfirmed,
    },
    isMatch,
    now
  );

  if (!evalResult.allowed) {
    if (record.presenceConfirmed && !record.used && now <= record.expiresAtMs) {
      record.attempts += 1;
    }
    return {
      ok: false,
      error: evalResult.reason || 'Verification failed.',
      remainingAttempts: evalResult.remainingAttempts,
    };
  }

  // One-time use: burn OTP immediately upon success
  record.used = true;
  record.otpPlainForWaiterRevealOnly = '';
  return { ok: true };
}

export function invalidateOtpRequest(requestId: string): void {
  otpStore.delete(requestId);
}
