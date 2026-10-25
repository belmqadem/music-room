// The backend address rules, kept apart from the storage (backend-url.ts) so they are tested in Node.

import { copy } from "@/copy";

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

export interface ServerAddressChange {
  /** The address in use now, normalized. */
  current: () => Promise<string>;
  /** Deletes a stored session (auth.forgetStoredSession). */
  forgetStoredSession: () => Promise<void>;
  /** Stores the new address (or removes the stored one, for the default). */
  store: () => Promise<void>;
}

/**
 * Switches to another server address (ADR-037). A stored session belongs to the old server, so a
 * different address first forgets it; if that fails, the address is NOT changed and the error is
 * raised. Saving the address already in use keeps the session.
 */
export async function changeServerAddress(
  next: string,
  change: ServerAddressChange,
): Promise<void> {
  if (next !== (await change.current())) await change.forgetStoredSession();
  await change.store();
}

export const SERVER_MESSAGES = {
  invalid: copy.settings.invalid,
  reachable: copy.settings.reachable,
  not_music_room: copy.settings.notMusicRoom,
  unreachable: copy.settings.unreachable,
  saved: copy.settings.saved,
  notSaved: copy.settings.notSaved,
};
