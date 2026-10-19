import { RequestError } from "./api-error";

// One HTTP call to the backend: URL, headers, JSON in and out, a timeout, and every failure turned
// into a RequestError. It knows nothing about sessions: the access token is handed in by the caller
// (see auth/auth-controller.ts for the refresh logic).

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface SendOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Sent as `Authorization: Bearer ...` when set. */
  accessToken?: string | null;
}

export interface HttpClient {
  send<T = void>(method: HttpMethod, path: string, options?: SendOptions): Promise<T>;
}

export interface HttpClientDeps {
  fetch: typeof fetch;
  /** Read on every call: the backend address can be changed at runtime (settings). */
  getBaseUrl: () => Promise<string>;
  /** X-Platform, X-Device and X-App-Version: the backend logs them for every action. */
  getClientHeaders: () => Record<string, string>;
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Every API path lives under this prefix (docs/api-contract.md, "Base path"). The backend address
 * from the settings is only the server (http://host:3000); the client adds the API version, so
 * callers write "/auth/login" exactly as the contract does.
 */
export const API_PREFIX = "/api/v1";

// Built by hand: URLSearchParams.toString() is not reliable on every React Native version.
function queryString(query: SendOptions["query"]): string {
  const parts = Object.entries(query ?? {})
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(
      ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

export function createHttpClient(deps: HttpClientDeps): HttpClient {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async send<T>(method: HttpMethod, path: string, options: SendOptions = {}) {
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...deps.getClientHeaders(),
      };
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      if (options.accessToken) headers["Authorization"] = `Bearer ${options.accessToken}`;

      // AbortSignal.timeout does not exist everywhere on React Native, hence the controller.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      let text: string;
      try {
        const baseUrl = await deps.getBaseUrl();
        response = await deps.fetch(
          `${baseUrl}${API_PREFIX}${path}${queryString(options.query)}`,
          {
            method,
            headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            signal: controller.signal,
          },
        );
        text = await response.text();
      } catch {
        // The reason (offline, DNS, refused, timeout) is not useful to the user; the address is.
        throw new RequestError(
          0,
          "NETWORK_ERROR",
          "The server could not be reached. Check your connection and the backend address.",
        );
      } finally {
        clearTimeout(timer);
      }

      let json: unknown = undefined;
      if (text !== "") {
        try {
          json = JSON.parse(text);
        } catch {
          throw new RequestError(
            response.status,
            "INVALID_RESPONSE",
            "The server answered something that is not JSON.",
          );
        }
      }

      if (!response.ok) {
        const error = (
          json as
            | { error?: { code?: unknown; message?: unknown; details?: unknown } }
            | undefined
        )?.error;
        if (error && typeof error.code === "string") {
          throw new RequestError(
            response.status,
            error.code as RequestError["code"],
            typeof error.message === "string" ? error.message : "The request failed.",
            error.details ?? null,
          );
        }
        throw new RequestError(
          response.status,
          "INVALID_RESPONSE",
          "The request failed.",
        );
      }
      return json as T;
    },
  };
}
