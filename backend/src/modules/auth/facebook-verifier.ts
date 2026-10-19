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

const GRAPH_URL = "https://graph.facebook.com";
const TIMEOUT_MS = 5000;

// Limited Login (ADR-032): values from Facebook's OpenID discovery document,
// https://limited.facebook.com/.well-known/openid-configuration/
const LIMITED_LOGIN_ISSUER = "https://www.facebook.com";
// A Limited Login token was observed valid for 90 days. The app sends it seconds after the login,
// so one issued longer ago than this is refused: a stolen token stops being useful quickly.
export const LIMITED_LOGIN_MAX_AGE = "10m";
const LIMITED_LOGIN_KEYS_URL = new URL(
  "https://www.facebook.com/.well-known/oauth/openid/jwks/",
);

// A JWT is three base64url parts separated by dots. A classic access token has no dots.
const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;

export interface FacebookVerifierOptions {
  appId: string;
  /** Server-side only. It lets us ask Facebook who a token was issued to. */
  appSecret: string;
  /** Tests replace the network. */
  fetch?: typeof fetch;
  /** Tests pass a local key set; production fetches Facebook's (cached by jose). */
  getKey?: JWTVerifyGetKey;
}

interface DebugTokenResponse {
  data?: { is_valid?: boolean; app_id?: string; user_id?: string };
}

interface MeResponse {
  id?: string;
  name?: string;
}

/**
 * Verifies the credential the app got from Facebook. Two kinds exist:
 *
 * - A Limited Login token (iOS, when the user does not allow tracking; ADR-032): an OpenID JWT,
 *   checked locally like Google's: signature against Facebook's public keys, RS256 only, issuer,
 *   audience = OUR app id (otherwise a token issued to another app could log in here), expiry.
 *
 * - A classic user access token, verified with the Graph API:
 *  1. debug_token (asked with our app token) tells whether the token is valid
 *     and WHICH APP it was issued to: it must be ours, otherwise a token from
 *     some other app could log in here;
 *  2. /me gives the display name.
 * The email is deliberately ignored (ADR-011): Facebook does not guarantee it is verified.
 */
export function createFacebookVerifier(
  options: FacebookVerifierOptions,
): ProviderVerifier {
  const doFetch = options.fetch ?? fetch;
  const appToken = `${options.appId}|${options.appSecret}`;
  const getKey = options.getKey ?? createRemoteJWKSet(LIMITED_LOGIN_KEYS_URL);

  async function verifyLimitedLoginToken(credential: string): Promise<ProviderIdentity> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(credential, getKey, {
        algorithms: ["RS256"],
        issuer: LIMITED_LOGIN_ISSUER,
        audience: options.appId,
        requiredClaims: ["sub", "exp", "iat"],
        maxTokenAge: LIMITED_LOGIN_MAX_AGE,
      }));
    } catch (error) {
      // jose's own errors mean "this token is bad"; anything else (the key download failing)
      // means we could not decide.
      if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)) {
        throw new ProviderCredentialError();
      }
      throw new ProviderUnavailableError("could not fetch Facebook keys");
    }
    if (typeof payload.sub !== "string" || payload.sub === "") {
      throw new ProviderCredentialError();
    }
    const name = payload["name"];
    return {
      providerUserId: payload.sub,
      displayName: typeof name === "string" ? name : null,
      // The token may carry an email; it is ignored for the same reason as below (ADR-011).
      verifiedEmail: null,
    };
  }

  // Never put the URL or the response in an error: they contain tokens.
  async function getJson<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = `${GRAPH_URL}${path}?${new URLSearchParams(params).toString()}`;
    let response: Response;
    try {
      response = await doFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new ProviderUnavailableError("could not reach Facebook");
    }
    // 400 is how the Graph API says "that token is not acceptable".
    if (response.status === 400) throw new ProviderCredentialError();
    if (!response.ok)
      throw new ProviderUnavailableError(`Facebook answered ${response.status}`);
    try {
      return (await response.json()) as T;
    } catch {
      throw new ProviderUnavailableError("Facebook sent an unreadable answer");
    }
  }

  return {
    async verify(credential): Promise<ProviderIdentity> {
      if (JWT_SHAPE.test(credential)) return verifyLimitedLoginToken(credential);

      const debug = await getJson<DebugTokenResponse>("/debug_token", {
        input_token: credential,
        access_token: appToken,
      });
      const data = debug.data;
      if (!data?.is_valid || data.app_id !== options.appId || !data.user_id) {
        throw new ProviderCredentialError();
      }

      const me = await getJson<MeResponse>("/me", {
        fields: "id,name",
        access_token: credential,
      });
      // The two answers must describe the same person.
      if (me.id !== data.user_id) throw new ProviderCredentialError();

      return {
        providerUserId: data.user_id,
        displayName: typeof me.name === "string" ? me.name : null,
        verifiedEmail: null,
      };
    },
  };
}
