import type { OAuthProvider } from "@music-room/shared";

/** What a provider confirmed about the person who holds a credential. */
export interface ProviderIdentity {
  /** Stable id at the provider (Google "sub", Facebook user id). Never the email. */
  providerUserId: string;
  displayName: string | null;
  /** Only an email the provider vouches for; otherwise null (ADR-011). */
  verifiedEmail: string | null;
  /**
   * When the credential stops being valid at the provider. The server remembers a credential it
   * accepted until then, so it can be used only once (ADR-047).
   */
  expiresAt: Date;
}

/** Checks a credential sent by the app WITH the provider. Never trusts the client's claims. */
export interface ProviderVerifier {
  verify(credential: string): Promise<ProviderIdentity>;
}

export type ProviderVerifiers = Record<OAuthProvider, ProviderVerifier>;

/** The provider rejected the credential (bad signature, expired, wrong app). The client's fault. */
export class ProviderCredentialError extends Error {
  constructor() {
    super("Provider credential rejected");
    this.name = "ProviderCredentialError";
  }
}

/** We could not get an answer (network, timeout, provider 5xx, our own misconfiguration). */
export class ProviderUnavailableError extends Error {
  constructor(reason: string) {
    super(`Provider unavailable: ${reason}`);
    this.name = "ProviderUnavailableError";
  }
}

/** Stands in for a provider that is not configured (no client id in .env). */
export const unconfiguredVerifier: ProviderVerifier = {
  verify() {
    return Promise.reject(new ProviderUnavailableError("not configured"));
  },
};
