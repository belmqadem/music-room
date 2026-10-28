import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRequestError, RequestError } from "@/api/api-error";
import { fail, networkDown, ok, session, setup, user } from "./helpers/fakes";

// The sign-in state and the authenticated calls (ADR-003, ADR-006, ADR-010), against a fake backend.

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function caught(promise: Promise<unknown>): Promise<RequestError> {
  try {
    await promise;
  } catch (error) {
    expect(isRequestError(error)).toBe(true);
    return error as RequestError;
  }
  throw new Error("expected the call to fail");
}

const bearer = (n: number) => `Bearer access-${n}`;

describe("starting the app (restore)", () => {
  it("starts in the loading state", () => {
    const { auth } = setup();

    expect(auth.getState()).toEqual({ status: "loading", user: null });
  });

  it("with nothing stored: signed out, and no request is made", async () => {
    const { auth, backend } = setup();

    await auth.restore();

    expect(auth.getState()).toEqual({ status: "signedOut", user: null });
    expect(backend.requests).toHaveLength(0);
  });

  it("with a stored refresh token: signs in again, keeps the NEW token, holds the access token in memory", async () => {
    const { auth, backend, storage } = setup({ storedRefreshToken: "stored-token" });
    backend.on("POST /auth/refresh", ok(session(1)));

    await auth.restore();

    expect(backend.requests[0]!.body).toEqual({ refreshToken: "stored-token" });
    expect(auth.getState().status).toBe("signedIn");
    expect(auth.getState().user?.displayName).toBe("Ada");
    expect(storage.value()).toBe("refresh-1");
    expect(auth.getAccessToken()).toBe("access-1");
  });

  it("when the server says the session is over: signed out and the token is deleted", async () => {
    const { auth, backend, storage } = setup({ storedRefreshToken: "old" });
    backend.on("POST /auth/refresh", fail(401, "INVALID_REFRESH_TOKEN"));

    await auth.restore();

    expect(auth.getState().status).toBe("signedOut");
    expect(storage.value()).toBeNull();
  });

  it.each([
    ["the server is unreachable", networkDown()],
    ["the server fails (500)", fail(500, "INTERNAL_ERROR")],
  ])(
    "when %s: signed out for now, but the stored token is KEPT for the next launch",
    async (_label, reply) => {
      const { auth, backend, storage } = setup({ storedRefreshToken: "keep-me" });
      backend.on("POST /auth/refresh", reply);

      await auth.restore();

      expect(auth.getState().status).toBe("signedOut");
      expect(storage.value()).toBe("keep-me");
    },
  );

  it("two restores at once make one refresh (a token can only be used once)", async () => {
    const { auth, backend } = setup({ storedRefreshToken: "t" });
    backend.on("POST /auth/refresh", ok(session(1)));

    await Promise.all([auth.restore(), auth.restore()]);

    expect(backend.count("POST /auth/refresh")).toBe(1);
  });

  it("can be tried again after a failure", async () => {
    const { auth, backend } = setup({ storedRefreshToken: "t" });
    backend.on("POST /auth/refresh", networkDown(), ok(session(1)));

    await auth.restore();
    await auth.restore();

    expect(auth.getState().status).toBe("signedIn");
  });
});

describe("signing in", () => {
  it("sends the credentials WITHOUT a bearer token, then holds the session", async () => {
    const { auth, backend, storage } = setup();
    backend.on("POST /auth/login", ok(session(1)));

    await auth.signIn({ email: "ada@example.invalid", password: "Correct-Horse-9!" });

    expect(backend.requests[0]!.headers["authorization"]).toBeUndefined();
    expect(backend.requests[0]!.body).toEqual({
      email: "ada@example.invalid",
      password: "Correct-Horse-9!",
    });
    expect(auth.getState()).toMatchObject({ status: "signedIn", user: { id: user.id } });
    expect(storage.value()).toBe("refresh-1");
    expect(auth.getAccessToken()).toBe("access-1");
  });

  it("an unverified account is refused with its code, and nothing is stored", async () => {
    const { auth, backend, storage } = setup();
    backend.on("POST /auth/login", fail(403, "EMAIL_NOT_VERIFIED"));

    const error = await caught(auth.signIn({ email: "a@b.invalid", password: "x" }));

    expect(error.code).toBe("EMAIL_NOT_VERIFIED");
    expect(auth.getState().status).not.toBe("signedIn");
    expect(storage.value()).toBeNull();
  });

  it("a wrong password (401) is just an error: no refresh is attempted and the stored token stays", async () => {
    const { auth, backend, storage } = setup({ storedRefreshToken: "keep" });
    backend.on("POST /auth/login", fail(401, "INVALID_CREDENTIALS"));

    const error = await caught(auth.signIn({ email: "a@b.invalid", password: "wrong" }));

    expect(error.code).toBe("INVALID_CREDENTIALS");
    expect(backend.count("POST /auth/refresh")).toBe(0);
    expect(storage.value()).toBe("keep");
  });

  it("signs in with a Google or Facebook credential through the provider's endpoint", async () => {
    const { auth, backend } = setup();
    backend.on("POST /auth/oauth/google", ok(session(1)));
    backend.on("POST /auth/oauth/facebook", fail(401, "INVALID_PROVIDER_CREDENTIAL"));

    await auth.signInWithProvider("google", "google-id-token");
    const error = await caught(auth.signInWithProvider("facebook", "bad"));

    expect(backend.requests[0]!.body).toEqual({ credential: "google-id-token" });
    expect(auth.getState().status).toBe("signedIn");
    expect(error.code).toBe("INVALID_PROVIDER_CREDENTIAL");
  });

  it("still signs in when the device storage refuses the write (the session lasts until the app closes)", async () => {
    const { auth, backend, storage } = setup();
    storage.flags.failSet = true;
    backend.on("POST /auth/login", ok(session(1)));

    await auth.signIn({ email: "a@b.invalid", password: "x" });

    expect(auth.getState().status).toBe("signedIn");
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("public endpoints (register, verify, reset)", () => {
  it("register returns the address to verify and does NOT sign in", async () => {
    const { auth, backend, storage } = setup();
    backend.on("POST /auth/register", ok({ email: "ada@example.invalid" }));

    const result = await auth.register({
      email: "ada@example.invalid",
      password: "Correct-Horse-9!",
    });

    expect(result).toEqual({ email: "ada@example.invalid" });
    expect(backend.requests[0]!.headers["authorization"]).toBeUndefined();
    expect(auth.getState().status).not.toBe("signedIn");
    expect(storage.value()).toBeNull();
  });

  it("verify, resend, forgot and reset send the right bodies, without a token", async () => {
    const { auth, backend } = setup();
    for (const route of [
      "POST /auth/verify-email",
      "POST /auth/resend-verification",
      "POST /auth/forgot-password",
      "POST /auth/reset-password",
    ]) {
      backend.on(route, ok());
    }

    await auth.verifyEmail({ email: "a@b.invalid", code: "123456" });
    await auth.resendVerification({ email: "a@b.invalid" });
    await auth.forgotPassword({ email: "a@b.invalid" });
    await auth.resetPassword({
      email: "a@b.invalid",
      code: "123456",
      newPassword: "New-Password-9!",
    });

    expect(backend.requests.map((r) => r.body)).toEqual([
      { email: "a@b.invalid", code: "123456" },
      { email: "a@b.invalid" },
      { email: "a@b.invalid" },
      { email: "a@b.invalid", code: "123456", newPassword: "New-Password-9!" },
    ]);
    expect(backend.requests.every((r) => r.headers["authorization"] === undefined)).toBe(
      true,
    );
  });

  it("a wrong code is INVALID_CODE and nothing refreshes or signs out", async () => {
    const { auth, backend } = setup({ storedRefreshToken: "t" });
    backend.on("POST /auth/refresh", ok(session(1)));
    await auth.restore();
    backend.on("POST /auth/verify-email", fail(400, "INVALID_CODE"));

    const error = await caught(
      auth.verifyEmail({ email: "a@b.invalid", code: "000000" }),
    );

    expect(error.code).toBe("INVALID_CODE");
    expect(auth.getState().status).toBe("signedIn");
  });
});

describe("authenticated calls", () => {
  async function signedIn(extra: Parameters<typeof setup>[0] = {}) {
    const ctx = setup({ storedRefreshToken: "stored", ...extra });
    ctx.backend.on("POST /auth/refresh", ok(session(1)));
    await ctx.auth.restore();
    ctx.backend.requests.length = 0;
    ctx.events.length = 0;
    return ctx;
  }

  it("sends the access token and returns the answer", async () => {
    const { auth, backend } = await signedIn();
    backend.on("GET /events", ok({ items: [], nextCursor: null }));

    const page = await auth.request("GET", "/events");

    expect(page).toEqual({ items: [], nextCursor: null });
    expect(backend.requests[0]!.headers["authorization"]).toBe(bearer(1));
  });

  it("an expired token: refreshes ONCE, saves the new refresh token BEFORE retrying, then repeats the call once", async () => {
    const { auth, backend, events, storage } = await signedIn();
    backend.on("GET /events", (req) =>
      req.headers["authorization"] === bearer(2)
        ? ok({ items: ["fresh"] })
        : fail(401, "TOKEN_EXPIRED"),
    );
    backend.on("POST /auth/refresh", ok(session(2)));

    const page = await auth.request("GET", "/events");

    expect(page).toEqual({ items: ["fresh"] });
    expect(backend.count("POST /auth/refresh")).toBe(1);
    expect(backend.requests.find((r) => r.path === "/auth/refresh")!.body).toEqual({
      refreshToken: "refresh-1",
    });
    expect(storage.value()).toBe("refresh-2");
    expect(events).toEqual([
      "request GET /events",
      "request POST /auth/refresh",
      "storage.set",
      "request GET /events",
    ]);
  });

  it("refreshAccessToken (for the live connection): a new access token, true", async () => {
    const { auth, backend, storage } = await signedIn();
    backend.on("POST /auth/refresh", ok(session(2)));

    await expect(auth.refreshAccessToken()).resolves.toBe(true);

    expect(auth.getAccessToken()).toBe("access-2");
    expect(storage.value()).toBe("refresh-2");
  });

  it("refreshAccessToken when the session is over: false, and signed out", async () => {
    const { auth, backend } = await signedIn();
    backend.on("POST /auth/refresh", fail(401, "INVALID_REFRESH_TOKEN"));

    await expect(auth.refreshAccessToken()).resolves.toBe(false);

    expect(auth.getState().status).toBe("signedOut");
    expect(auth.getAccessToken()).toBeNull();
  });

  it("refreshAccessToken offline: the error is raised and the session kept for a later try", async () => {
    const { auth, backend, storage } = await signedIn();
    backend.on("POST /auth/refresh", networkDown());

    const error = await caught(auth.refreshAccessToken());

    expect(error.code).toBe("NETWORK_ERROR");
    expect(auth.getState().status).toBe("signedIn");
    expect(storage.value()).toBe("refresh-1");
  });

  it("refreshAccessToken and a REST call expiring together share ONE refresh", async () => {
    const { auth, backend } = await signedIn();
    backend.on("GET /events", (req) =>
      req.headers["authorization"] === bearer(2)
        ? ok({ n: 1 })
        : fail(401, "TOKEN_EXPIRED"),
    );
    backend.on("POST /auth/refresh", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return ok(session(2));
    });

    const [, refreshed] = await Promise.all([
      auth.request("GET", "/events"),
      auth.refreshAccessToken(),
    ]);

    expect(refreshed).toBe(true);
    expect(backend.count("POST /auth/refresh")).toBe(1);
  });

  it("five calls expiring together make ONE refresh (a second use of a token would end the session)", async () => {
    const { auth, backend } = await signedIn();
    backend.on("GET /events", (req) =>
      req.headers["authorization"] === bearer(2)
        ? ok({ n: 1 })
        : fail(401, "TOKEN_EXPIRED"),
    );
    backend.on("POST /auth/refresh", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return ok(session(2));
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => auth.request("GET", "/events")),
    );

    expect(results).toHaveLength(5);
    expect(backend.count("POST /auth/refresh")).toBe(1);
    expect(backend.count("GET /events")).toBe(10); // five refused, five repeated
  });

  it("a call whose 'expired' answer arrives after another call already refreshed just repeats; no second refresh", async () => {
    const { auth, backend } = await signedIn();
    // The slow call was sent with access-1; its expiry answer comes back only after the refresh finished.
    backend.on("GET /slow", async (req) => {
      if (req.headers["authorization"] === bearer(2)) return ok({ done: true });
      await new Promise((resolve) => setTimeout(resolve, 60));
      return fail(401, "TOKEN_EXPIRED");
    });
    backend.on("GET /fast", (req) =>
      req.headers["authorization"] === bearer(2)
        ? ok({ done: true })
        : fail(401, "TOKEN_EXPIRED"),
    );
    backend.on("POST /auth/refresh", ok(session(2)));

    const slow = auth.request("GET", "/slow");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const fast = auth.request("GET", "/fast");
    await Promise.all([slow, fast]);

    expect(backend.count("POST /auth/refresh")).toBe(1);
  });

  it("if the refresh is refused (session over): the call fails as UNAUTHENTICATED, the user is signed out, the token deleted", async () => {
    const { auth, backend, storage } = await signedIn();
    backend.on("GET /events", fail(401, "TOKEN_EXPIRED"));
    backend.on("POST /auth/refresh", fail(401, "INVALID_REFRESH_TOKEN"));

    const error = await caught(auth.request("GET", "/events"));

    expect(error.code).toBe("UNAUTHENTICATED");
    expect(auth.getState()).toEqual({ status: "signedOut", user: null });
    expect(storage.value()).toBeNull();
    expect(auth.getAccessToken()).toBeNull();
  });

  it("if the repeated call is refused again (401): the session ends instead of looping", async () => {
    const { auth, backend } = await signedIn();
    backend.on("GET /events", fail(401, "TOKEN_EXPIRED"));
    backend.on("POST /auth/refresh", ok(session(2)));

    const error = await caught(auth.request("GET", "/events"));

    expect(error.status).toBe(401);
    expect(backend.count("GET /events")).toBe(2); // not three
    expect(backend.count("POST /auth/refresh")).toBe(1);
    expect(auth.getState().status).toBe("signedOut");
  });

  it("if the refresh cannot reach the server: the call fails with NETWORK_ERROR and the session is KEPT", async () => {
    const { auth, backend, storage } = await signedIn();
    backend.on("GET /events", fail(401, "TOKEN_EXPIRED"));
    backend.on("POST /auth/refresh", networkDown());

    const error = await caught(auth.request("GET", "/events"));

    expect(error.code).toBe("NETWORK_ERROR");
    expect(auth.getState().status).toBe("signedIn");
    expect(storage.value()).toBe("refresh-1");
  });

  it.each([
    [403, "REAUTH_FAILED"],
    [403, "FORBIDDEN"],
    [403, "NOT_INVITED"],
    [404, "EVENT_NOT_FOUND"],
    [409, "TRACK_ALREADY_QUEUED"],
    [429, "RATE_LIMITED"],
    [500, "INTERNAL_ERROR"],
    [401, "UNAUTHENTICATED"],
  ] as const)(
    "%i %s is passed through: no refresh, the session stays",
    async (status, code) => {
      const { auth, backend } = await signedIn();
      backend.on("POST /x", fail(status, code));

      const error = await caught(auth.request("POST", "/x", { body: {} }));

      expect(error.code).toBe(code);
      expect(backend.count("POST /auth/refresh")).toBe(0);
      expect(auth.getState().status).toBe("signedIn");
    },
  );

  it("a public call never sends the token, even when signed in", async () => {
    const { auth, backend } = await signedIn();
    backend.on("POST /auth/forgot-password", ok());

    await auth.forgotPassword({ email: "a@b.invalid" });

    expect(backend.requests[0]!.headers["authorization"]).toBeUndefined();
  });

  it("refreshes with the token found in storage at that moment (another tab may have rotated it)", async () => {
    const { auth, backend, storage } = await signedIn();
    await storage.storage.set("rotated-by-another-tab");
    backend.on("GET /events", (req) =>
      req.headers["authorization"] === bearer(2) ? ok({}) : fail(401, "TOKEN_EXPIRED"),
    );
    backend.on("POST /auth/refresh", ok(session(2)));

    await auth.request("GET", "/events");

    expect(backend.requests.find((r) => r.path === "/auth/refresh")!.body).toEqual({
      refreshToken: "rotated-by-another-tab",
    });
  });

  it("takes the cross-tab lock for a refresh, once, even when several calls need it", async () => {
    let locked = 0;
    const lock = async <T>(task: () => Promise<T>) => {
      locked++;
      return task();
    };
    const { auth, backend } = await signedIn({ lock });
    locked = 0;
    backend.on("GET /events", (req) =>
      req.headers["authorization"] === bearer(2) ? ok({}) : fail(401, "TOKEN_EXPIRED"),
    );
    backend.on("POST /auth/refresh", ok(session(2)));

    await Promise.all([
      auth.request("GET", "/events"),
      auth.request("GET", "/events"),
      auth.request("GET", "/events"),
    ]);

    expect(locked).toBe(1);
  });

  it("refreshUser reloads the user into the state", async () => {
    const { auth, backend } = await signedIn();
    backend.on(
      "GET /users/me",
      ok({ ...user, displayName: "Ada L.", linkedProviders: ["google"] }),
    );

    await auth.refreshUser();

    expect(auth.getState().user).toMatchObject({
      displayName: "Ada L.",
      linkedProviders: ["google"],
    });
    expect(auth.getState().status).toBe("signedIn");
  });
});

describe("signing out", () => {
  async function signedIn() {
    const ctx = setup({ storedRefreshToken: "stored" });
    ctx.backend.on("POST /auth/refresh", ok(session(1)));
    await ctx.auth.restore();
    ctx.backend.requests.length = 0;
    return ctx;
  }

  it("tells the server which session to end, then forgets everything", async () => {
    const { auth, backend, storage } = await signedIn();
    backend.on("POST /auth/logout", ok());

    const result = await auth.signOut();

    expect(backend.requests[0]!.body).toEqual({ refreshToken: "refresh-1" });
    expect(backend.requests[0]!.headers["authorization"]).toBe(bearer(1));
    expect(result).toEqual({ serverRevoked: true });
    expect(auth.getState()).toEqual({ status: "signedOut", user: null });
    expect(storage.value()).toBeNull();
    expect(auth.getAccessToken()).toBeNull();
  });

  it("works offline: signed out here, and the caller is told the server was not reached", async () => {
    const { auth, backend, storage } = await signedIn();
    backend.on("POST /auth/logout", networkDown());

    const result = await auth.signOut();

    expect(result).toEqual({ serverRevoked: false });
    expect(auth.getState().status).toBe("signedOut");
    expect(storage.value()).toBeNull();
  });

  it("with an expired access token: refreshes, still ends the session on the server, and signs out", async () => {
    const { auth, backend, storage } = await signedIn();
    backend.on("POST /auth/logout", (req) =>
      req.headers["authorization"] === bearer(2) ? ok() : fail(401, "TOKEN_EXPIRED"),
    );
    backend.on("POST /auth/refresh", ok(session(2)));

    const result = await auth.signOut();

    expect(result.serverRevoked).toBe(true);
    expect(auth.getState().status).toBe("signedOut");
    expect(storage.value()).toBeNull();
  });

  it("when the device storage cannot delete the token: the state is signed out, and the error is raised, not hidden", async () => {
    const { auth, backend, storage } = await signedIn();
    backend.on("POST /auth/logout", ok());
    storage.flags.failClear = true;

    await expect(auth.signOut()).rejects.toThrow("storage clear failed");

    expect(auth.getState().status).toBe("signedOut");
    expect(auth.getAccessToken()).toBeNull();
  });

  it("when nobody is signed in: no request, nothing to revoke", async () => {
    const { auth, backend } = setup();
    await auth.restore();

    const result = await auth.signOut();

    expect(backend.requests).toHaveLength(0);
    expect(result).toEqual({ serverRevoked: true });
  });
});

describe("before the server address changes (forgetStoredSession)", () => {
  it("deletes a token kept from an offline start, so it is never sent to the new server", async () => {
    const { auth, backend, storage } = setup({ storedRefreshToken: "old-server-token" });
    backend.on("POST /auth/refresh", networkDown());
    await auth.restore();
    expect(storage.value()).toBe("old-server-token");

    await auth.forgetStoredSession();

    expect(storage.value()).toBeNull();
    expect(auth.getState()).toEqual({ status: "signedOut", user: null });
    // The next launch has nothing to send anywhere.
    backend.requests.length = 0;
    await auth.restore();
    expect(backend.requests).toHaveLength(0);
  });

  it("is refused while signed in, and the session is left as it was", async () => {
    const { auth, backend, storage } = setup({ storedRefreshToken: "stored" });
    backend.on("POST /auth/refresh", ok(session(1)));
    await auth.restore();

    await expect(auth.forgetStoredSession()).rejects.toThrow("Sign out before");

    expect(auth.getState().status).toBe("signedIn");
    expect(storage.value()).toBe("refresh-1");
    expect(auth.getAccessToken()).toBe("access-1");
  });

  it("waits for a restore still running: one that signs in makes it refuse", async () => {
    const { auth, backend, storage } = setup({ storedRefreshToken: "stored" });
    let answer: (reply: ReturnType<typeof ok>) => void = () => undefined;
    backend.on("POST /auth/refresh", () => new Promise((resolve) => (answer = resolve)));
    const restoring = auth.restore();

    const forgetting = auth.forgetStoredSession();
    await vi.waitFor(() => expect(backend.requests).toHaveLength(1));
    answer(ok(session(1)));
    await restoring;

    await expect(forgetting).rejects.toThrow("Sign out before");
    expect(storage.value()).toBe("refresh-1");
  });

  it("waits for a restore still running: one that fails offline is then forgotten", async () => {
    const { auth, backend, storage } = setup({ storedRefreshToken: "stored" });
    let answer: (reply: ReturnType<typeof networkDown>) => void = () => undefined;
    backend.on("POST /auth/refresh", () => new Promise((resolve) => (answer = resolve)));
    const restoring = auth.restore();

    const forgetting = auth.forgetStoredSession();
    await vi.waitFor(() => expect(backend.requests).toHaveLength(1));
    answer(networkDown());
    await restoring;
    await forgetting;

    expect(storage.value()).toBeNull();
  });

  it("when the device storage cannot delete the token: the error is raised, not hidden", async () => {
    const { auth, backend, storage } = setup({ storedRefreshToken: "stored" });
    backend.on("POST /auth/refresh", networkDown());
    await auth.restore();
    storage.flags.failClear = true;

    await expect(auth.forgetStoredSession()).rejects.toThrow("storage clear failed");
  });

  it("with nothing stored: nothing to do, and no request", async () => {
    const { auth, backend, storage } = setup();
    await auth.restore();

    await auth.forgetStoredSession();

    expect(storage.value()).toBeNull();
    expect(backend.requests).toHaveLength(0);
  });
});

describe("observing the state", () => {
  it("tells listeners about each change, and stops after unsubscribe", async () => {
    const { auth, backend } = setup({ storedRefreshToken: "t" });
    backend.on("POST /auth/refresh", ok(session(1)));
    backend.on("POST /auth/logout", ok());
    const seen: string[] = [];
    const unsubscribe = auth.subscribe(() => seen.push(auth.getState().status));

    await auth.restore();
    await auth.signOut();
    unsubscribe();
    await auth.restore();

    expect(seen).toEqual(["signedIn", "signedOut"]);
  });

  it("gives the same state object until something changes (React compares it by identity)", async () => {
    const { auth } = setup();

    const before = auth.getState();
    expect(auth.getState()).toBe(before);
    await auth.restore();

    expect(auth.getState()).not.toBe(before);
    expect(auth.getState()).toBe(auth.getState());
  });
});

describe("offline mode: starting without the server (ADR-049)", () => {
  it("with a saved user, opens signed in on it instead of the sign-in screen", async () => {
    const { auth, backend, storage } = setup({
      storedRefreshToken: "refresh-0",
      savedUser: user,
    });
    backend.on("POST /auth/refresh", networkDown());

    await auth.restore();

    expect(auth.getState()).toEqual({ status: "signedIn", user });
    expect(auth.getAccessToken()).toBeNull();
    expect(storage.value()).toBe("refresh-0");
  });

  it("without a saved user, stays signed out (and keeps the token for next time)", async () => {
    const { auth, backend, storage } = setup({
      storedRefreshToken: "refresh-0",
      savedUser: null,
    });
    backend.on("POST /auth/refresh", networkDown());

    await auth.restore();

    expect(auth.getState().status).toBe("signedOut");
    expect(storage.value()).toBe("refresh-0");
  });

  it("a session the server refuses is never opened from the saved user", async () => {
    const { auth, backend, saved } = setup({
      storedRefreshToken: "refresh-0",
      savedUser: user,
    });
    backend.on("POST /auth/refresh", fail(401, "INVALID_REFRESH_TOKEN"));

    await auth.restore();

    expect(auth.getState().status).toBe("signedOut");
    expect(saved.user).toBeNull();
  });

  it("the first call once the server is back gets a token first, then goes through", async () => {
    const { auth, backend } = setup({ storedRefreshToken: "refresh-0", savedUser: user });
    backend.on("POST /auth/refresh", networkDown(), ok(session(1)));
    backend.on("GET /events", ok({ items: [], nextCursor: null }));
    await auth.restore();

    await auth.request("GET", "/events");

    const call = backend.requests.find((r) => r.path === "/events")!;
    expect(call.headers["authorization"]).toBe("Bearer access-1");
  });

  it("still offline, that call fails with NETWORK_ERROR and nothing is lost", async () => {
    const { auth, backend } = setup({ storedRefreshToken: "refresh-0", savedUser: user });
    backend.on("POST /auth/refresh", networkDown());
    await auth.restore();

    const error = await auth.request("GET", "/events").catch((e: unknown) => e);

    expect((error as { code: string }).code).toBe("NETWORK_ERROR");
    expect(auth.getState().status).toBe("signedIn");
  });

  it("if the server ended the session meanwhile, that call signs out and forgets the saved user", async () => {
    const { auth, backend, saved } = setup({
      storedRefreshToken: "refresh-0",
      savedUser: user,
    });
    backend.on("POST /auth/refresh", networkDown(), fail(401, "INVALID_REFRESH_TOKEN"));
    await auth.restore();

    const error = await auth.request("GET", "/events").catch((e: unknown) => e);

    expect((error as { code: string }).code).toBe("UNAUTHENTICATED");
    expect(auth.getState().status).toBe("signedOut");
    expect(saved.user).toBeNull();
  });

  it("keeps the user whenever it is signed in, and forgets it on sign-out", async () => {
    const { auth, backend, saved } = setup({ savedUser: null });
    backend.on("POST /auth/login", ok(session(1)));
    backend.on("POST /auth/logout", ok());

    await auth.signIn({ email: "ada@example.invalid", password: "pw" });
    await new Promise((r) => setTimeout(r, 0));
    expect(saved.user?.id).toBe(user.id);

    await auth.signOut();
    expect(saved.user).toBeNull();
  });
});
