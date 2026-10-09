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
// TODO(contract): decide whether other users may see `email` (privacy) or only the user themself.
