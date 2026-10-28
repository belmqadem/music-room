import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import {
  ProviderCredentialError,
  ProviderUnavailableError,
  type ProviderIdentity,
  type ProviderVerifier,
} from "./provider-verifier.js";

const GOOGLE_KEYS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");
// Google documents both spellings of the issuer.
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
// An ID token is valid for about an hour, but the app sends it seconds after the sign-in: one
// issued longer ago than this is refused, so a stolen token stops being useful quickly (ADR-047).
export const GOOGLE_TOKEN_MAX_AGE = "10m";

export interface GoogleVerifierOptions {
  /** Accepted audiences: our iOS, Android and Web OAuth client ids. */
  clientIds: string[];
  /** Tests pass a local key set; production fetches Google's (cached by jose). */
  getKey?: JWTVerifyGetKey;
}

/**
 * Verifies a Google ID token (a JWT) locally: signature against Google's public
 * keys, issuer, audience (must be one of OUR client ids, otherwise a token
 * issued to another app could log in here), expiry, and age (issued at most 10
 * minutes ago). RS256 only, so a token claiming HS256 or "none" is rejected.
 */
export function createGoogleVerifier(options: GoogleVerifierOptions): ProviderVerifier {
  const getKey = options.getKey ?? createRemoteJWKSet(GOOGLE_KEYS_URL);
  return {
    async verify(credential) {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(credential, getKey, {
          // jose already refuses HS256 against an RSA key; the pin is a second line of defence.
          algorithms: ["RS256"],
          issuer: GOOGLE_ISSUERS,
          audience: options.clientIds,
          requiredClaims: ["sub", "exp", "iat"],
          maxTokenAge: GOOGLE_TOKEN_MAX_AGE,
        }));
      } catch (error) {
        // jose's own errors mean "this token is bad"; anything else (such as the
        // key download failing) means we could not decide.
        if (error instanceof errors.JOSEError && !isKeyFetchFailure(error)) {
          throw new ProviderCredentialError();
        }
        throw new ProviderUnavailableError("could not fetch Google keys");
      }
      return toIdentity(payload);
    },
  };
}

function isKeyFetchFailure(error: errors.JOSEError): boolean {
  return error instanceof errors.JWKSTimeout;
}

function toIdentity(payload: JWTPayload): ProviderIdentity {
  if (typeof payload.sub !== "string" || payload.sub === "") {
    throw new ProviderCredentialError();
  }
  const email = typeof payload["email"] === "string" ? payload["email"] : null;
  // Older tokens carry email_verified as the string "true".
  const verified =
    payload["email_verified"] === true || payload["email_verified"] === "true";
  const name = payload["name"];
  return {
    providerUserId: payload.sub,
    displayName: typeof name === "string" ? name : null,
    verifiedEmail: email && verified ? email : null,
    // requiredClaims guarantees exp.
    expiresAt: new Date((payload.exp ?? 0) * 1000),
  };
}
