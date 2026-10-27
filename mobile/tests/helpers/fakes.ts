import type { AuthSession } from "@music-room/shared";
import { createHttpClient } from "@/api/http-client";
import { createAuthController, type RefreshTokenStorage } from "@/auth/auth-controller";

// A fake backend and a fake token storage, so the real client and controller run in Node.

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}
export type Reply = { status: number; body?: unknown } | Error;
type Responder = (request: RecordedRequest) => Reply | Promise<Reply>;

export const ok = (body?: unknown): Reply => ({
  status: body === undefined ? 204 : 200,
  body,
});
export const fail = (
  status: number,
  code: string,
  message = "nope",
  details: unknown = null,
): Reply => ({
  status,
  body: { error: { code, message, details } },
});
export const networkDown = (): Reply => new TypeError("Network request failed");

export function createFakeBackend(events: string[] = []) {
  const requests: RecordedRequest[] = [];
  const routes = new Map<string, Responder[]>();

  /** Answers `METHOD /path`. Several replies are used in order; the last one repeats. */
  function on(route: string, ...replies: (Responder | Reply)[]): void {
    routes.set(
      route,
      replies.map((reply) => (typeof reply === "function" ? reply : () => reply)),
    );
  }

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const recorded: RecordedRequest = {
      method: init?.method ?? "GET",
      // The fake answers the contract's paths; the real prefix is checked in http-client.test.ts.
      path: url.pathname.replace(/^\/api\/v1(?=\/)/, ""),
      headers,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    };
    requests.push(recorded);
    events.push(`request ${recorded.method} ${recorded.path}`);

    const key = `${recorded.method} ${recorded.path}`;
    const responders = routes.get(key);
    if (!responders) throw new Error(`fake backend: no route for ${key}`);
    const index = requests.filter((r) => `${r.method} ${r.path}` === key).length - 1;
    const reply = await responders[Math.min(index, responders.length - 1)]!(recorded);
    if (reply instanceof Error) throw reply;

    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return {
    fetch: fetchImpl,
    requests,
    on,
    count: (route: string) =>
      requests.filter((r) => `${r.method} ${r.path}` === route).length,
  };
}

export function createFakeStorage(initial: string | null = null, events: string[] = []) {
  let value = initial;
  const flags = { failGet: false, failSet: false, failClear: false };
  const storage: RefreshTokenStorage = {
    async get() {
      if (flags.failGet) throw new Error("storage read failed");
      return value;
    },
    async set(token) {
      events.push("storage.set");
      if (flags.failSet) throw new Error("storage write failed");
      value = token;
    },
    async clear() {
      events.push("storage.clear");
      if (flags.failClear) throw new Error("storage clear failed");
      value = null;
    },
  };
  return { storage, flags, value: () => value };
}

export const user = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Ada",
  email: "ada@example.invalid",
  emailVerified: true,
  linkedProviders: [],
  displayNameSet: true,
  plan: "free",
  hasPassword: true,
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

/** A session whose tokens carry `n`, so a test can tell the first from the second. */
export const session = (n: number): AuthSession => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
  expiresIn: 900,
  user: { ...user, linkedProviders: [] },
});

export const CLIENT_HEADERS = {
  "X-Platform": "ios",
  "X-Device": "test-phone",
  "X-App-Version": "1.2.3",
};

export function setup(
  options: {
    storedRefreshToken?: string | null;
    lock?: <T>(task: () => Promise<T>) => Promise<T>;
  } = {},
) {
  const events: string[] = [];
  const backend = createFakeBackend(events);
  const fakeStorage = createFakeStorage(options.storedRefreshToken ?? null, events);
  const http = createHttpClient({
    fetch: backend.fetch,
    getBaseUrl: async () => "http://backend.test",
    getClientHeaders: () => CLIENT_HEADERS,
    timeoutMs: 1000,
  });
  const auth = createAuthController({
    http,
    storage: fakeStorage.storage,
    ...(options.lock && { runExclusiveRefresh: options.lock }),
  });
  return { auth, backend, storage: fakeStorage, events, http };
}
