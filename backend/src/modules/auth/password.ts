import bcrypt from "bcrypt";

// Password hashing (ADR-006). bcrypt, cost 12: each hash costs ~0.25 s of CPU,
// which makes guessing passwords from a leaked database slow.
export const BCRYPT_COST = 12;
export const PASSWORD_MIN_BYTES = 8;
// bcrypt silently ignores everything after 72 bytes. Rather than let two
// different long passwords look the same, longer ones are rejected.
export const PASSWORD_MAX_BYTES = 72;

/** Length is measured in bytes (UTF-8), because that is what bcrypt limits. */
export function isPasswordAcceptable(plain: string): boolean {
  const bytes = Buffer.byteLength(plain, "utf8");
  return bytes >= PASSWORD_MIN_BYTES && bytes <= PASSWORD_MAX_BYTES;
}

// Strength rules applied when a password is CHOSEN (register). Login and hash
// verification only use isPasswordAcceptable, so an account can never be locked
// out by a rule that was added after it was created.
const STRENGTH_RULES: ReadonlyArray<{ pattern: RegExp; message: string }> = [
  { pattern: /\p{Ll}/u, message: "Password must contain a lowercase letter." },
  { pattern: /\p{Lu}/u, message: "Password must contain an uppercase letter." },
  { pattern: /\p{Nd}/u, message: "Password must contain a digit." },
  // A symbol is anything that is not a letter, a digit or whitespace.
  { pattern: /[^\p{L}\p{N}\s]/u, message: "Password must contain a symbol." },
];

/** Messages for every strength rule the password breaks (empty = strong enough). Length is checked separately. */
export function passwordStrengthViolations(plain: string): string[] {
  return STRENGTH_RULES.filter((rule) => !rule.pattern.test(plain)).map(
    (rule) => rule.message,
  );
}

/** @throws Error if the password breaks the length rule (callers should validate first). */
export async function hashPassword(
  plain: string,
  cost: number = BCRYPT_COST,
): Promise<string> {
  if (!isPasswordAcceptable(plain)) {
    throw new Error(`Password must be ${PASSWORD_MIN_BYTES}-${PASSWORD_MAX_BYTES} bytes`);
  }
  return bcrypt.hash(plain, cost);
}

// A valid hash of a throwaway value, computed once. Used when the account does
// not exist so that "unknown email" costs the same time as "wrong password";
// otherwise response time would reveal which emails are registered.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash("not-a-real-password", BCRYPT_COST);
  return dummyHash;
}

/**
 * Checks a password against a stored hash. Pass `null` when no account/hash was
 * found: the function still does a full bcrypt comparison, then returns false.
 */
export async function verifyPassword(
  plain: string,
  storedHash: string | null,
): Promise<boolean> {
  if (storedHash === null || !isPasswordAcceptable(plain)) {
    // Spend the same time as a real check. An over-long input can never match
    // a stored hash (we never store such passwords), so it must not match a truncation either.
    await bcrypt.compare(plain, await getDummyHash());
    return false;
  }
  return bcrypt.compare(plain, storedHash);
}
