import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

// One-time codes sent by email (ADR-022): to prove ownership of an address and to reset a password.

export type EmailCodePurpose = "verify_email" | "reset_password";

export const EMAIL_CODE_LENGTH = 6;
export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
/** Tries allowed per code, right or wrong. A million values / 5 tries is 1 in 200,000 per code. */
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
/** A new code for the same user and purpose is refused until this has passed. */
export const EMAIL_CODE_RESEND_COOLDOWN_MS = 60 * 1000;

/** A random code of digits, zero-padded: "004217". randomInt is unbiased and uses the OS CSPRNG. */
export function generateEmailCode(): string {
  return randomInt(0, 10 ** EMAIL_CODE_LENGTH)
    .toString()
    .padStart(EMAIL_CODE_LENGTH, "0");
}

/**
 * Keyed hash of a code. The purpose and the user id are part of the message, so a code for one
 * purpose or one user can never match another's. The key is the server secret: a leaked
 * database alone cannot be used to recover codes.
 */
export function hashEmailCode(
  code: string,
  purpose: EmailCodePurpose,
  userId: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${purpose}:${userId}:${code}`)
    .digest("hex");
}

/** Constant-time comparison of two hex hashes of the same length. */
export function emailCodeHashesMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
