import crypto from 'node:crypto';
import { canResendOtp, evaluateOtpChallenge } from '../src/lib/otpRules.ts';
import {
  deleteOtpChallenge,
  getOtpChallenge,
  getOtpTableRateTimestamps,
  saveOtpChallenge,
  saveOtpTableRateTimestamps,
} from './db.ts';

function hashOtp(otp: string, salt: string): string {
  return crypto.createHash('sha256').update(`${salt}:${otp}`).digest('hex');
}

export async function issueOtpForRequest(params: {
  requestId: string;
  tableId: string;
  expirySeconds: number;
  cooldownSeconds: number;
  maxAttempts: number;
  isResend?: boolean;
}): Promise<{ ok: true; expiresAt: string } | { ok: false; error: string; retryAfterSeconds?: number }> {
  const now = Date.now();

  // Rate-limit: max 8 requests per table in 10 minutes (persisted across serverless calls)
  const windowMs = 10 * 60 * 1000;
  const storedTimestamps = await getOtpTableRateTimestamps(params.tableId);
  const recent = storedTimestamps.filter((t) => now - t < windowMs);
  if (recent.length >= 8) {
    return {
      ok: false,
      error: 'Too many verification requests for this table. Please ask your waiter for assistance.',
      retryAfterSeconds: 60,
    };
  }

  const existing = await getOtpChallenge(params.requestId);
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

  await saveOtpChallenge({
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
  await saveOtpTableRateTimestamps(params.tableId, recent);

  return {
    ok: true,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export async function confirmPresenceAndRevealOtp(
  requestId: string,
  waiterId: string
): Promise<{ ok: true; otp: string; expiresAt: string } | { ok: false; error: string }> {
  const record = await getOtpChallenge(requestId);
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
  await saveOtpChallenge(record);
  return {
    ok: true,
    otp: record.otpPlainForWaiterRevealOnly,
    expiresAt: new Date(record.expiresAtMs).toISOString(),
  };
}

export async function verifyOtpSubmission(
  requestId: string,
  submittedOtp: string
): Promise<{ ok: true } | { ok: false; error: string; remainingAttempts: number }> {
  const record = await getOtpChallenge(requestId);
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
      await saveOtpChallenge(record);
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
  await saveOtpChallenge(record);
  return { ok: true };
}

export async function invalidateOtpRequest(requestId: string): Promise<void> {
  await deleteOtpChallenge(requestId);
}
