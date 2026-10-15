import { Writable } from "node:stream";
import type { Express } from "express";
import pg from "pg";
import pino from "pino";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createMemoryMailer } from "../helpers/memory-mailer.js";
import { signUpVerified } from "../helpers/sign-up.js";
import { createPostgresPool } from "../../src/db/postgres.js";

// Refresh-token rotation, reuse detection and logout against a real, migrated
// Postgres (set TEST_DATABASE_URL; see `make test-integration`).
//
// Rules under test (ADR-003, ADR-006, "strict" policy):
//  - every refresh consumes the presented token and issues a new one in the same "family";
//  - presenting a token that was ALREADY consumed means it may have been stolen:
//    the whole family is revoked, so the legitimate holder must log in again;
//  - every failure looks the same to the client (INVALID_REFRESH_TOKEN).
const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(32);
const EMAIL_DOMAIN = "@refresh-flow.invalid";
const PASSWORD = "Correct-Horse-Battery-9";

interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string };
}

describe.skipIf(!databaseUrl)("refresh and logout", () => {
  let pool: pg.Pool;
  let app: Express;
  const mailer = createMemoryMailer();
  let logLines: string[];

  beforeAll(() => {
    pool = createPostgresPool(databaseUrl!);
    logLines = [];
    app = buildApp();
  });
  afterEach(async () => {
    await pool.query("DELETE FROM users WHERE email LIKE $1", [`%${EMAIL_DOMAIN}`]);
    logLines.length = 0;
  });
  afterAll(async () => {
    await pool.end();
  });

  function buildApp(overrides: Partial<Parameters<typeof createApp>[0]> = {}): Express {
    // Captures warn+ log lines so a test can assert what was logged (and what was not).
    const sink = new Writable({
      write(chunk, _encoding, done) {
        logLines.push(String(chunk));
        done();
      },
    });
    return createApp({
      pool,
      jwtSecret: SECRET,
      logger: pino({ level: "warn" }, sink),
      passwordCost: 4,
      mailer,
      loginLimit: { windowMs: 60_000, limit: 10_000 },
      registerLimit: { windowMs: 60_000, limit: 10_000 },
      refreshLimit: { windowMs: 60_000, limit: 10_000 },
      emailCodeLimit: { windowMs: 60_000, limit: 10_000 },
      ...overrides,
    });
  }

  const email = (name: string) => `${name}${EMAIL_DOMAIN}`;
  const post = (path: string, body: object, target: Express = app) =>
    request(target).post(`/api/v1${path}`).send(body);
  const refresh = (refreshToken: string, target: Express = app) =>
    post("/auth/refresh", { refreshToken }, target);
  const logout = (accessToken: string, refreshToken: string) =>
    request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ refreshToken });

  async function registerUser(name = "bob"): Promise<Session> {
    const response = await signUpVerified(app, mailer, {
      email: email(name),
      password: PASSWORD,
      displayName: name,
    });
    return response.body as Session;
  }
  async function loginUser(name = "bob"): Promise<Session> {
    const response = await post("/auth/login", {
      email: email(name),
      password: PASSWORD,
    });
    return response.body as Session;
  }
  const me = (accessToken: string) =>
    request(app).get("/api/v1/users/me").set("Authorization", `Bearer ${accessToken}`);

  async function tokenRows(userId: string) {
    const { rows } = await pool.query(
      `SELECT family_id, used_at, revoked_at FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    );
    return rows as { family_id: string; used_at: Date | null; revoked_at: Date | null }[];
  }

  const INVALID_REFRESH = {
    error: {
      code: "INVALID_REFRESH_TOKEN",
      message: "Refresh token is invalid or expired.",
      details: null,
    },
  };

  describe("POST /auth/refresh: normal rotation", () => {
    it("returns a new session and a different refresh token (200)", async () => {
      const session = await registerUser();

      const response = await refresh(session.refreshToken);

      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body.expiresIn).toBe(900);
      expect(response.body.user.id).toBe(session.user.id);
      expect(response.body.refreshToken).not.toBe(session.refreshToken);
      expect(response.body.accessToken).toEqual(expect.any(String));
    });

    it("gives an access token that works", async () => {
      const session = await registerUser();

      const response = await refresh(session.refreshToken);

      expect((await me(response.body.accessToken)).status).toBe(200);
    });

    it("works without any Authorization header (the access token may have expired)", async () => {
      const session = await registerUser();

      const response = await request(app)
        .post("/api/v1/auth/refresh")
        .set("Authorization", "Bearer expired.or.garbage")
        .send({ refreshToken: session.refreshToken });

      expect(response.status).toBe(200);
    });

    it("marks the old token used and keeps the new one in the same family", async () => {
      const session = await registerUser();
      await refresh(session.refreshToken);

      const rows = await tokenRows(session.user.id);

      expect(rows).toHaveLength(2);
      expect(rows[0]!.used_at).not.toBeNull();
      expect(rows[1]!.used_at).toBeNull();
      expect(rows[1]!.family_id).toBe(rows[0]!.family_id);
      expect(rows.every((row) => row.revoked_at === null)).toBe(true);
    });

    it("can be chained: each new token refreshes again", async () => {
      let token = (await registerUser()).refreshToken;

      for (let i = 0; i < 5; i++) {
        const response = await refresh(token);
        expect(response.status).toBe(200);
        token = response.body.refreshToken;
      }
    });
  });

  describe("POST /auth/refresh: reuse detection (strict)", () => {
    it("rejects a token that was already used (401 INVALID_REFRESH_TOKEN)", async () => {
      const session = await registerUser();
      await refresh(session.refreshToken);

      const replay = await refresh(session.refreshToken);

      expect(replay.status).toBe(401);
      expect(replay.body).toEqual(INVALID_REFRESH);
    });

    it("revokes the WHOLE family when a used token comes back, including the newest token", async () => {
      const session = await registerUser();
      const rotated = await refresh(session.refreshToken);

      await refresh(session.refreshToken); // the replay (attacker or retry)
      const newestToken = await refresh(rotated.body.refreshToken);

      expect(newestToken.status).toBe(401);
      const rows = await tokenRows(session.user.id);
      expect(rows.every((row) => row.revoked_at !== null)).toBe(true);
    });

    it("leaves the user's OTHER sessions (other devices) untouched", async () => {
      const phone = await registerUser();
      const tablet = await loginUser(); // separate family
      const rotated = await refresh(phone.refreshToken);
      await refresh(phone.refreshToken); // replay on the phone family

      const tabletRefresh = await refresh(tablet.refreshToken);

      expect(rotated.status).toBe(200);
      expect(tabletRefresh.status).toBe(200);
    });

    it("does not touch other USERS' sessions", async () => {
      const bob = await registerUser("bob");
      const alice = await registerUser("alice");
      await refresh(bob.refreshToken);
      await refresh(bob.refreshToken); // replay

      expect((await refresh(alice.refreshToken)).status).toBe(200);
    });

    it("logs a warning with user and family but never the token itself", async () => {
      const session = await registerUser();
      await refresh(session.refreshToken);

      await refresh(session.refreshToken);

      const warning = logLines.join("");
      expect(warning).toContain("refresh token reuse");
      expect(warning).toContain(session.user.id);
      expect(warning).not.toContain(session.refreshToken);
    });
  });

  describe("POST /auth/refresh: invalid tokens all look the same", () => {
    it("rejects an unknown token with the identical body as a replay", async () => {
      const session = await registerUser();
      await refresh(session.refreshToken);

      const unknown = await refresh("x".repeat(43));
      const replay = await refresh(session.refreshToken);

      expect(unknown.status).toBe(401);
      expect(unknown.body).toEqual(INVALID_REFRESH);
      expect(replay.body).toEqual(unknown.body);
    });

    it("rejects an expired token and does not consume it", async () => {
      const session = await registerUser();
      await pool.query(
        "UPDATE refresh_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = $1",
        [session.user.id],
      );

      const response = await refresh(session.refreshToken);

      expect(response.status).toBe(401);
      expect(response.body).toEqual(INVALID_REFRESH);
      expect((await tokenRows(session.user.id))[0]!.used_at).toBeNull();
    });

    it("rejects a token after its user was deleted", async () => {
      const session = await registerUser();
      await pool.query("DELETE FROM users WHERE id = $1", [session.user.id]);

      expect((await refresh(session.refreshToken)).status).toBe(401);
    });

    it("rejects an access token used as a refresh token", async () => {
      const session = await registerUser();

      expect((await refresh(session.accessToken)).status).toBe(401);
    });

    it.each([
      ["no body fields", {}],
      ["a non-string token", { refreshToken: 12345 }],
      ["an empty token", { refreshToken: "" }],
      ["a huge token", { refreshToken: "a".repeat(5000) }],
      ["an unknown field", { refreshToken: "abc", extra: true }],
    ])("answers 400 VALIDATION_ERROR for %s", async (_label, body) => {
      const response = await post("/auth/refresh", body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /auth/refresh: simultaneous requests", () => {
    it("lets exactly one of 2 simultaneous refreshes with the same token win", async () => {
      const session = await registerUser();

      const responses = await Promise.all([
        refresh(session.refreshToken),
        refresh(session.refreshToken),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
    });

    // Several requests replaying one token at once used to deadlock inside Postgres
    // (each revoked the same family of rows in its own order) and some got a 500
    // instead of 401. A single round rarely showed it, so run many.
    it("lets exactly one of 10 simultaneous refreshes win, round after round", async () => {
      for (let round = 0; round < 25; round++) {
        const session = await registerUser(`racer-${round}`); // a new account each round

        const responses = await Promise.all(
          Array.from({ length: 10 }, () => refresh(session.refreshToken)),
        );

        const statuses = responses.map((r) => r.status).sort();
        expect(statuses, `round ${round}`).toEqual([200, ...Array(9).fill(401)]);
      }
    });

    it("(strict) also invalidates the winner's new token, so a retry logs the user out", async () => {
      const session = await registerUser();
      const responses = await Promise.all([
        refresh(session.refreshToken),
        refresh(session.refreshToken),
      ]);
      const winner = responses.find((r) => r.status === 200)!;

      const next = await refresh(winner.body.refreshToken);

      expect(next.status).toBe(401);
    });
  });

  describe("POST /auth/logout", () => {
    it("revokes the session: its refresh token stops working (204)", async () => {
      const session = await registerUser();

      const response = await logout(session.accessToken, session.refreshToken);

      expect(response.status).toBe(204);
      expect((await refresh(session.refreshToken)).status).toBe(401);
    });

    it("revokes the newest token of the family too, not only the one presented", async () => {
      const session = await registerUser();
      const rotated = await refresh(session.refreshToken);

      await logout(rotated.body.accessToken, session.refreshToken); // old (used) token of same family

      expect((await refresh(rotated.body.refreshToken)).status).toBe(401);
      const rows = await tokenRows(session.user.id);
      expect(rows.every((row) => row.revoked_at !== null)).toBe(true);
    });

    it("leaves the user's other devices logged in", async () => {
      const phone = await registerUser();
      const tablet = await loginUser();

      await logout(phone.accessToken, phone.refreshToken);

      expect((await refresh(tablet.refreshToken)).status).toBe(200);
    });

    it("cannot be used to log out ANOTHER user's session", async () => {
      const bob = await registerUser("bob");
      const alice = await registerUser("alice");

      const response = await logout(alice.accessToken, bob.refreshToken);

      expect(response.status).toBe(204); // same answer as always: no oracle
      expect((await refresh(bob.refreshToken)).status).toBe(200); // bob is still logged in
    });

    it("answers 204 for an unknown token and when called twice (idempotent)", async () => {
      const session = await registerUser();

      const unknown = await logout(session.accessToken, "x".repeat(43));
      const first = await logout(session.accessToken, session.refreshToken);
      const second = await logout(session.accessToken, session.refreshToken);

      expect([unknown.status, first.status, second.status]).toEqual([204, 204, 204]);
    });

    it("requires authentication (401 without an access token)", async () => {
      const session = await registerUser();

      const response = await post("/auth/logout", { refreshToken: session.refreshToken });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
      expect((await refresh(session.refreshToken)).status).toBe(200); // not revoked
    });

    it("answers 400 for a missing refreshToken", async () => {
      const session = await registerUser();

      const response = await request(app)
        .post("/api/v1/auth/logout")
        .set("Authorization", `Bearer ${session.accessToken}`)
        .send({});

      expect(response.status).toBe(400);
    });

    it("does not cancel the current access token (stateless: it lives until it expires)", async () => {
      const session = await registerUser();
      await logout(session.accessToken, session.refreshToken);

      expect((await me(session.accessToken)).status).toBe(200);
    });
  });

  describe("rate limiting", () => {
    it("works with the default limits when none are configured", async () => {
      const withDefaults = createApp({
        pool,
        jwtSecret: SECRET,
        logger: pino({ level: "silent" }),
      });

      const response = await refresh("x".repeat(43), withDefaults);

      expect(response.status).toBe(401);
    });

    it("limits refresh attempts per IP with 429 RATE_LIMITED", async () => {
      const limited = buildApp({ refreshLimit: { windowMs: 60_000, limit: 2 } });

      const statuses = [];
      for (let i = 0; i < 3; i++)
        statuses.push((await refresh("x".repeat(43), limited)).status);

      expect(statuses).toEqual([401, 401, 429]);
    });
  });
});
