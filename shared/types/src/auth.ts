// API contract: authentication. Owner: belmqadem (Core & Infra). Changes need review from BOTH developers.
// See docs/api-contract.md ("Authentication") and ADR-003.
import type { User } from "./user";

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

/** Returned by register, login, refresh and OAuth. */
export interface AuthSession {
  accessToken: string; // short-lived JWT, sent as `Authorization: Bearer`
  refreshToken: string; // opaque, rotated on every use
  expiresIn: number; // seconds until accessToken expires
  user: User;
}

// TODO(contract): OAuth request body once provider(s) and flow are decided.
