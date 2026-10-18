import type { RefreshTokenStorage } from "./auth-controller";

// The refresh token in a browser (ADR-012, option A): localStorage, shared by every tab of the app.
// The cost is accepted and written down: a script injected into the page could read it
// (docs/security.md). Where the browser refuses storage (private mode, blocked site data) the token
// is kept in memory: the session lasts until the tab closes, and the warning says so.
const KEY = "music-room.refresh-token";

export function createWebStorage(
  storage:
    | Pick<Storage, "getItem" | "setItem" | "removeItem">
    | undefined = globalThis.localStorage,
): RefreshTokenStorage {
  let fallback: string | null = null;
  const warnOnce = (() => {
    let warned = false;
    return (error: unknown) => {
      if (warned) return;
      warned = true;
      console.warn(
        "Browser storage is not available; the session lasts until the tab closes:",
        error,
      );
    };
  })();

  return {
    async get() {
      try {
        return storage?.getItem(KEY) ?? fallback;
      } catch (error) {
        warnOnce(error);
        return fallback;
      }
    },
    async set(token) {
      fallback = token;
      try {
        storage?.setItem(KEY, token);
      } catch (error) {
        warnOnce(error);
      }
    },
    async clear() {
      fallback = null;
      try {
        storage?.removeItem(KEY);
      } catch (error) {
        warnOnce(error);
      }
    },
  };
}

/**
 * ADR-012 / contract: with several tabs open only one may refresh at a time (a token used twice
 * revokes the session). navigator.locks makes the tabs take turns; the controller reads the
 * refresh token from storage inside the turn, so a tab that waited uses the newer token.
 */
export function createWebRefreshLock():
  (<T>(task: () => Promise<T>) => Promise<T>) | undefined {
  const locks = globalThis.navigator?.locks;
  if (!locks) return undefined;
  return <T>(task: () => Promise<T>) => locks.request("music-room.refresh", task);
}
