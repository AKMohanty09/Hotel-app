import test from 'node:test';
import assert from 'node:assert/strict';
import { canResendOtp, evaluateOtpChallenge } from './otpRules';

test('OTP cannot succeed before waiter confirms physical presence', () => {
  const now = 1_000_000;
  const res = evaluateOtpChallenge(
    {
      expiresAtMs: now + 180_000,
      lastSentAtMs: now,
      attempts: 0,
      maxAttempts: 5,
      used: false,
      presenceConfirmed: false,
    },
    true,
    now + 1000
  );
  assert.equal(res.allowed, false);
  assert.match(res.reason || '', /physically confirm/);
});

test('Expired or mismatched OTP is rejected cleanly', () => {
  const now = 1_000_000;
  const expired = evaluateOtpChallenge(
    {
      expiresAtMs: now - 1,
      lastSentAtMs: now - 180_000,
      attempts: 0,
      maxAttempts: 5,
      used: false,
      presenceConfirmed: true,
    },
    true,
    now
  );
  assert.equal(expired.allowed, false);
  assert.match(expired.reason || '', /expired/);

  const wrong = evaluateOtpChallenge(
    {
      expiresAtMs: now + 60_000,
      lastSentAtMs: now,
      attempts: 1,
      maxAttempts: 5,
      used: false,
      presenceConfirmed: true,
    },
    false,
    now + 2000
  );
  assert.equal(wrong.allowed, false);
  assert.equal(wrong.remainingAttempts, 3);
});

test('Resend cooldown blocks rapid repeated OTP requests', () => {
  const now = 1_000_000;
  const blocked = canResendOtp(now - 10_000, now, 30);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.waitSeconds, 20);

  const ok = canResendOtp(now - 35_000, now, 30);
  assert.equal(ok.allowed, true);
});
