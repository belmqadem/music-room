// API contract: user. Owner: belmqadem (Core & Infra). Changes need review from BOTH developers.
// See docs/api-contract.md ("Authentication").

export type OAuthProvider = "google" | "facebook";

/** A user. Never contains secrets (no password hash, no tokens). */
export interface User {
  id: string; // UUID
  displayName: string;
  /** Null for social-only accounts whose provider gave no email (Facebook may not). */
  email: string | null;
  /** Social accounts linked to this user. */
  linkedProviders: OAuthProvider[];
  createdAt: string; // ISO 8601 UTC
}
/**
 * What other users may see of someone: enough to recognise them, nothing private.
 * No email, no linked providers (those are only in `User`, returned to the user themself).
 * Display names are not unique, so two results can look alike; the id tells them apart.
 */
export interface UserSummary {
  id: string; // UUID
  displayName: string;
}
