// API contract: user. Owner: belmqadem (Core & Infra). Changes need review from BOTH developers.
// See docs/api-contract.md ("Authentication").

export type OAuthProvider = "google" | "facebook";

/** A user. Never contains secrets (no password hash, no tokens). */
export interface User {
  id: string; // UUID
  /**
   * The unique name people find you by (ADR-046). Until `displayNameSet`, a temporary one
   * (`user_` and 12 hex digits) that nobody can search for.
   */
  displayName: string;
  /**
   * False until the user has chosen their display name. Until then every signed-in endpoint
   * except reading `/users/me`, choosing the name and signing out answers 403 DISPLAY_NAME_REQUIRED.
   */
  displayNameSet: boolean;
  /** Null for social-only accounts whose provider gave no email (Facebook may not). */
  email: string | null;
  /** True once the address was proven (a code from the email, or a provider that vouches for it). */
  emailVerified: boolean;
  /** Social accounts linked to this user. */
  linkedProviders: OAuthProvider[];
  /**
   * True when the account can sign in with a password (ADR-044). Social-only accounts cannot, so
   * the app never asks them for one to confirm a link or unlink. Its login methods are the linked
   * providers plus one for the password.
   */
  hasPassword: boolean;
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
