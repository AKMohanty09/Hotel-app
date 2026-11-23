export interface OtpChallengeState {
  expiresAtMs: number;
  lastSentAtMs: number;
  attempts: number;
  maxAttempts: number;
  used: boolean;
  presenceConfirmed: boolean;
}

export interface OtpEvaluationResult {
  allowed: boolean;
  reason?: string;
  remainingAttempts: number;
}

export function canResendOtp(
  lastSentAtMs: number,
  nowMs: number,
  cooldownSeconds: number
): { allowed: boolean; waitSeconds: number } {
  const elapsedSeconds = (nowMs - lastSentAtMs) / 1000;
  if (elapsedSeconds < cooldownSeconds) {
    return {
      allowed: false,
      waitSeconds: Math.ceil(cooldownSeconds - elapsedSeconds),
    };
  }
  return { allowed: true, waitSeconds: 0 };
}

export function evaluateOtpChallenge(
  challenge: OtpChallengeState,
  isCodeMatch: boolean,
  nowMs: number
): OtpEvaluationResult {
  if (challenge.used) {
    return {
      allowed: false,
      reason: 'This verification OTP has already been used.',
      remainingAttempts: 0,
    };
  }
  if (!challenge.presenceConfirmed) {
    return {
      allowed: false,
      reason: 'Waiter must physically confirm your table presence before verification.',
      remainingAttempts: Math.max(0, challenge.maxAttempts - challenge.attempts),
    };
  }
  if (nowMs > challenge.expiresAtMs) {
    return {
      allowed: false,
      reason: 'OTP has expired. Please tap Resend Verification to request a fresh code.',
      remainingAttempts: 0,
    };
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    return {
      allowed: false,
      reason: 'Maximum verification attempts exceeded. Please request a new verification.',
      remainingAttempts: 0,
    };
  }
  if (!isCodeMatch) {
    const nextAttempts = challenge.attempts + 1;
    const remaining = Math.max(0, challenge.maxAttempts - nextAttempts);
    return {
      allowed: false,
      reason:
        remaining > 0
          ? `Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : 'Invalid OTP. Maximum attempts reached.',
      remainingAttempts: remaining,
    };
  }
  return {
    allowed: true,
    remainingAttempts: Math.max(0, challenge.maxAttempts - challenge.attempts),
  };
}
