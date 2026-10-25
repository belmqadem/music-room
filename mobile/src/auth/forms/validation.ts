// Client-side checks for the auth forms. They MIRROR the backend's rules (backend/src/modules/auth/
// schema.ts and password.ts) so the user gets an answer before the network, but the backend still
// decides: a test compares these with the backend's own rules.

import { copy } from "@/copy";

export const EMAIL_MAX_LENGTH = 254;
export const DISPLAY_NAME_MAX_LENGTH = 50;
export const PASSWORD_MIN_BYTES = 8;
// bcrypt ignores everything after 72 bytes, so the backend refuses longer passwords.
export const PASSWORD_MAX_BYTES = 72;
export const CODE_LENGTH = 6;

/** What the backend stores: trimmed and lowercased, so "Ada@X.com " and "ada@x.com" are one account. */
export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

/**
 * UTF-8 length in bytes, which is what bcrypt limits ("é" is 2 bytes, an emoji 4). Counted by hand
 * because TextEncoder is not available on every React Native version.
 */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export type PasswordRule = "lowercase" | "uppercase" | "digit" | "symbol";

// The same Unicode-aware rules as the backend: any script's letters and digits count.
const PASSWORD_RULES: readonly { rule: PasswordRule; pattern: RegExp; label: string }[] =
  [
    {
      rule: "lowercase",
      pattern: /\p{Ll}/u,
      label: copy.auth.validation.passwordRules.lowercase,
    },
    {
      rule: "uppercase",
      pattern: /\p{Lu}/u,
      label: copy.auth.validation.passwordRules.uppercase,
    },
    {
      rule: "digit",
      pattern: /\p{Nd}/u,
      label: copy.auth.validation.passwordRules.digit,
    },
    // A symbol is anything that is not a letter, a digit or whitespace.
    {
      rule: "symbol",
      pattern: /[^\p{L}\p{N}\s]/u,
      label: copy.auth.validation.passwordRules.symbol,
    },
  ];

export function missingPasswordRules(password: string): PasswordRule[] {
  return PASSWORD_RULES.filter(({ pattern }) => !pattern.test(password)).map(
    ({ rule }) => rule,
  );
}

/** "a digit", "a digit and a symbol", "a lowercase letter, a digit and a symbol". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${copy.auth.validation.and} ${items[items.length - 1]}`;
}

export const PASSWORD_POLICY_HINT = copy.auth.validation.passwordPolicy;

/** For a password being CHOSEN (sign-up, reset). Null when the backend will accept it. */
export function newPasswordError(password: string): string | null {
  if (password.length === 0) return copy.auth.validation.choosePassword;
  const bytes = utf8Length(password);
  if (bytes < PASSWORD_MIN_BYTES) return copy.auth.validation.passwordTooShort;
  if (bytes > PASSWORD_MAX_BYTES) {
    return copy.auth.validation.passwordTooLong;
  }
  const missing = missingPasswordRules(password);
  if (missing.length === 0) return null;
  const labels = PASSWORD_RULES.filter(({ rule }) => missing.includes(rule)).map(
    ({ label }) => label,
  );
  return copy.auth.validation.passwordMissing(listOf(labels));
}

/** Sign-in only needs something: the rules apply when a password is chosen, not when it is used. */
export const signInPasswordError = (password: string): string | null =>
  password.length === 0 ? copy.auth.validation.enterPassword : null;

// A plain shape check; the backend's stricter check has the last word.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailError(raw: string): string | null {
  const email = normalizeEmail(raw);
  if (email.length === 0) return copy.auth.validation.enterEmail;
  if (email.length > EMAIL_MAX_LENGTH) return copy.auth.validation.emailTooLong;
  if (!EMAIL_SHAPE.test(email)) return copy.auth.validation.emailShape;
  return null;
}

export function displayNameError(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0) return copy.auth.validation.chooseDisplayName;
  // The backend counts UTF-16 units (JavaScript's .length), so the same count is used here.
  if (name.length > DISPLAY_NAME_MAX_LENGTH)
    return copy.auth.validation.displayNameTooLong;
  return null;
}

export function codeError(raw: string): string | null {
  const code = raw.trim();
  if (code.length === 0) return copy.auth.validation.enterCode;
  if (!/^\d{6}$/.test(code)) return copy.auth.validation.codeShape;
  return null;
}
