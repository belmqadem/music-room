import {
  ProviderCredentialError,
  ProviderUnavailableError,
  type ProviderIdentity,
  type ProviderVerifier,
} from "./provider-verifier.js";

const GRAPH_URL = "https://graph.facebook.com";
const TIMEOUT_MS = 5000;

export interface FacebookVerifierOptions {
  appId: string;
  /** Server-side only. It lets us ask Facebook who a token was issued to. */
  appSecret: string;
  /** Tests replace the network. */
  fetch?: typeof fetch;
}

interface DebugTokenResponse {
  data?: { is_valid?: boolean; app_id?: string; user_id?: string };
}

interface MeResponse {
  id?: string;
  name?: string;
}

/**
 * Verifies a Facebook user access token with the Graph API:
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
