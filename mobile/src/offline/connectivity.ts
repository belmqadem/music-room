// Whether the server can be reached (offline mode). Learned from the requests themselves: one that
// cannot reach the server marks the app offline, any answer (even an error) marks it online. While
// offline, a light ping (`/health`) every few seconds notices when the server is back, so the app
// can sync and reload without waiting for the user to do something.
//
// No network-status library: what matters is reaching OUR server, which a phone with Wi-Fi but no
// route to the backend cannot do either.

export interface Connectivity {
  isOnline(): boolean;
  /** Called on every change; returns the unsubscribe function. */
  subscribe(listener: (online: boolean) => void): () => void;
  /** A request could not reach the server. */
  reportUnreachable(): void;
  /** The server answered (whatever it said). */
  reportReachable(): void;
}

export function createConnectivity(deps: {
  /** Resolves true when the server answers its health check. */
  ping: () => Promise<boolean>;
  every?: number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}): Connectivity {
  const every = deps.every ?? 8000;
  const setTimer = deps.setTimer ?? ((run, ms) => setInterval(run, ms));
  const clearTimer = deps.clearTimer ?? ((timer) => clearInterval(timer as number));
  let online = true;
  let timer: unknown = null;
  let pinging = false;
  const listeners = new Set<(online: boolean) => void>();

  function set(next: boolean): void {
    if (next === online) return;
    online = next;
    if (online && timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (!online && timer === null) timer = setTimer(() => void probe(), every);
    listeners.forEach((listener) => listener(online));
  }

  async function probe(): Promise<void> {
    if (pinging) return; // a slow ping must not pile up
    pinging = true;
    try {
      if (await deps.ping()) set(true);
    } catch {
      // still unreachable: try again at the next tick
    } finally {
      pinging = false;
    }
  }

  return {
    isOnline: () => online,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reportUnreachable: () => set(false),
    reportReachable: () => set(true),
  };
}
