// The backend address rules, kept apart from the storage (backend-url.ts) so they are tested in Node.

/** Returns a normalized http(s) URL without trailing slash, or throws. */
export function normalizeBackendUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`Invalid backend URL: "${input}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Backend URL must start with http:// or https:// (got "${input}")`);
  }
  return url.toString().replace(/\/+$/, "");
}

export type ServerCheck =
  /** It answered like a Music Room backend. */
  | "reachable"
  /** Something answered, but not a Music Room backend (another service on that address). */
  | "not_music_room"
  /** Nothing answered in time (wrong address, server down, another network). */
  | "unreachable";

export const SERVER_CHECK_TIMEOUT_MS = 5_000;

/** GET <address>/health, which a Music Room backend answers with `{ "status": "ok" }`. */
export async function checkServer(
  address: string,
  fetchFn: typeof fetch,
  timeoutMs = SERVER_CHECK_TIMEOUT_MS,
): Promise<ServerCheck> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(`${address}/health`, { signal: controller.signal });
    if (!response.ok) return "not_music_room";
    const body = (await response.json().catch(() => null)) as { status?: unknown } | null;
    return body?.status === "ok" ? "reachable" : "not_music_room";
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timer);
  }
}

export const SERVER_MESSAGES = {
  invalid:
    "Enter an address that starts with http:// or https://, like http://192.168.1.20:3000.",
  reachable: "Connected: this is a Music Room server.",
  not_music_room:
    "Something answered at this address, but it is not a Music Room server.",
  unreachable:
    "No answer from this address. Check it, and that this phone is on the same network.",
  saved: "Saved. The app now uses this server.",
} as const;
