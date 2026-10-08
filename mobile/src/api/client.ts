import { getBackendUrl } from "@/settings/backend-url";
import { buildClientHeaders } from "./client-headers";

/**
 * fetch wrapper for the REST API: resolves the base URL at call time (so a
 * runtime change applies immediately) and adds the client-info headers.
 * `path` must start with "/", e.g. apiFetch("/health").
 * TODO(auth): attach the access token once the auth flow exists.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const baseUrl = await getBackendUrl();
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(buildClientHeaders())) {
    headers.set(name, value);
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
