// API contract: authentication. Owner: belmqadem (Core & Infra). Changes need review from BOTH developers.
// See docs/api-contract.md ("Authentication") and ADR-003.
import type { OAuthProvider, User } from "./user";

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

/** Returned by register: no session yet, the email must be verified first. */
export interface RegisterResult {
  email: string;
}

/** Body of POST /auth/verify-email: the 6-digit code that was emailed. */
export interface VerifyEmailRequest {
  email: string;
  code: string;
}

/** Body of POST /auth/resend-verification and POST /auth/forgot-password. */
export interface EmailRequest {
  email: string;
}

/** Body of POST /auth/reset-password. */
export interface ResetPasswordRequest {
  email: string;
  code: string;
  newPassword: string;
}

/** Returned by login, refresh and OAuth. */
export interface AuthSession {
  accessToken: string; // short-lived JWT, sent as `Authorization: Bearer`
  refreshToken: string; // opaque, rotated on every use
  expiresIn: number; // seconds until accessToken expires
  user: User;
}

/**
 * Body of POST /auth/oauth/{provider} and POST /users/me/providers/{provider}.
 * `credential` is what the provider's SDK gave the app: the Google ID token, or the
 * Facebook access token, or on iOS the Facebook Limited Login token (a JWT, ADR-032).
 * The backend verifies it with the provider (ADR-007).
 */
export interface OAuthCredentialRequest {
  credential: string;
}

/**
 * Proof that the person holding the access token is the account's owner, using a login method the
 * account ALREADY has (ADR-025): its password, or a fresh credential from a provider already linked.
 * Wrong or missing proof is `403 REAUTH_FAILED`.
 */
export type Reauth =
  | { method: "password"; password: string }
  | { method: "provider"; provider: OAuthProvider; credential: string };

/** Body of POST /users/me/providers/{provider}: the NEW account to link, plus proof of ownership. */
export interface LinkProviderRequest {
  credential: string;
  reauth: Reauth;
}

/** Body of DELETE /users/me/providers/{provider}. */
export interface UnlinkProviderRequest {
  reauth: Reauth;
}
