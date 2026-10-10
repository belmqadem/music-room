import { createHash, randomBytes } from "node:crypto";

// Refresh tokens (ADR-003, ADR-006): opaque random value, 7 days, stored only as a hash.
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Makes a new refresh token. `token` goes to the client once; only `hash` is
 * stored. 32 random bytes = 256 bits: unguessable, so a plain fast SHA-256 is
 * enough (slow hashes like bcrypt are for low-entropy human passwords).
 */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashRefreshToken(token) };
}

/** Hex SHA-256 (64 chars), the format the refresh_tokens table expects. */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
}
