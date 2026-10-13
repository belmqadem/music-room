import { createHash } from "node:crypto";
import type { Express } from "express";
import pg from "pg";
import pino from "pino";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";
import { signAccessToken } from "../../src/modules/auth/access-token.js";

// End-to-end tests of register / login / GET /users/me against a real, migrated
// Postgres (set TEST_DATABASE_URL; see `make test-integration`). Without it the
// file is skipped. The app commits for real, so every test uses emails on the
// reserved ".invalid" domain and they are all deleted after each test.
const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(32);
const EMAIL_DOMAIN = "@auth-flow.invalid";
const PASSWORD = "correct horse battery";

describe.skipIf(!databaseUrl)("auth flow (register, login, me)", () => {
  let pool: pg.Pool;
  let app: Express;

  beforeAll(() => {
    pool = createPostgresPool(databaseUrl!);
    app = buildApp();
  });
  afterEach(async () => {
    await pool.query("DELETE FROM users WHERE email LIKE $1", [`%${EMAIL_DOMAIN}`]);
  });
  afterAll(async () => {
    await pool.end();
  });

  // passwordCost 4 (bcrypt's minimum) keeps the tests fast; limits are high so
  // they do not interfere (rate limiting has its own tests).
  function buildApp(overrides: Partial<Parameters<typeof createApp>[0]> = {}): Express {
    return createApp({
      pool,
      jwtSecret: SECRET,
      logger: pino({ level: "silent" }),
      passwordCost: 4,
      loginLimit: { windowMs: 60_000, limit: 10_000 },
      registerLimit: { windowMs: 60_000, limit: 10_000 },
      ...overrides,
    });
  }

  const email = (name: string) => `${name}${EMAIL_DOMAIN}`;
  const register = (body: object) =>
    request(app).post("/api/v1/auth/register").send(body);
  const login = (body: object) => request(app).post("/api/v1/auth/login").send(body);
  const registerBob = () =>
    register({ email: email("bob"), password: PASSWORD, displayName: "Bob" });

  describe("POST /auth/register", () => {
    it("creates the account and returns a session (201)", async () => {
      const response = await registerBob();

      expect(response.status).toBe(201);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toMatchObject({
        expiresIn: 900,
        user: {
          email: email("bob"),
          displayName: "Bob",
          linkedProviders: [],
        },
      });
      expect(response.body.user.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.body.accessToken.split(".")).toHaveLength(3);
      expect(response.body.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it("never returns the password or its hash", async () => {
      const response = await registerBob();

      const text = JSON.stringify(response.body).toLowerCase();
      expect(text).not.toContain("password");
      expect(text).not.toContain("$2b$");
      expect(text).not.toContain(PASSWORD);
    });

    it("stores a bcrypt hash, not the password", async () => {
      await registerBob();

      const { rows } = await pool.query(
        "SELECT password_hash FROM users WHERE email = $1",
        [email("bob")],
      );
      expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);
      expect(rows[0].password_hash).not.toContain(PASSWORD);
    });

    it("stores only the SHA-256 hash of the refresh token, with a 7 day expiry", async () => {
      const response = await registerBob();

      const { rows } = await pool.query(
        "SELECT token_hash, expires_at FROM refresh_tokens WHERE user_id = $1",
        [response.body.user.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].token_hash).toBe(
        createHash("sha256").update(response.body.refreshToken).digest("hex"),
      );
      expect(rows[0].token_hash).not.toBe(response.body.refreshToken);
      const days = (rows[0].expires_at.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThanOrEqual(7);
    });

    it("lowercases the email it stores", async () => {
      const response = await register({
        email: `  MiXeD${EMAIL_DOMAIN.toUpperCase()} `,
        password: PASSWORD,
        displayName: "Mixed",
      });

      expect(response.status).toBe(201);
      expect(response.body.user.email).toBe(`mixed${EMAIL_DOMAIN}`);
    });

    it("answers 409 EMAIL_TAKEN for the same email, whatever its letter case", async () => {
      await registerBob();

      const response = await register({
        email: email("BOB"),
        password: "another password",
        displayName: "Impostor",
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("EMAIL_TAKEN");
    });

    it("lets exactly one of 8 simultaneous registrations of one email win", async () => {
      const responses = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          register({
            email: email("race"),
            password: PASSWORD,
            displayName: `Racer ${i}`,
          }),
        ),
      );

      const statuses = responses.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409, 409, 409, 409]);
      const { rows } = await pool.query(
        "SELECT count(*)::int AS n FROM users WHERE email = $1",
        [email("race")],
      );
      expect(rows[0].n).toBe(1);
    });

    it("leaves no user behind when the account cannot be completed (all-or-nothing)", async () => {
      // Second registration fails on the unique index; it must not leave tokens or users.
      await registerBob();
      await register({ email: email("bob"), password: PASSWORD, displayName: "Again" });

      const { rows } = await pool.query(
        `SELECT (SELECT count(*)::int FROM users WHERE email = $1) AS users,
                (SELECT count(*)::int FROM refresh_tokens t JOIN users u ON u.id = t.user_id
                  WHERE u.email = $1) AS tokens`,
        [email("bob")],
      );
      expect(rows[0]).toEqual({ users: 1, tokens: 1 });
    });

    it.each([
      ["no body fields", {}],
      ["an invalid email", { email: "nope", password: PASSWORD, displayName: "X" }],
      ["a short password", { email: email("a"), password: "short12", displayName: "X" }],
      [
        "a 73 byte password",
        { email: email("a"), password: "a".repeat(73), displayName: "X" },
      ],
      [
        "an empty display name",
        { email: email("a"), password: PASSWORD, displayName: "" },
      ],
      [
        "an unknown field",
        { email: email("a"), password: PASSWORD, displayName: "X", isAdmin: true },
      ],
    ])("answers 400 VALIDATION_ERROR for %s", async (_label, body) => {
      const response = await register(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      const { rows } = await pool.query(
        "SELECT count(*)::int AS n FROM users WHERE email LIKE $1",
        [`%${EMAIL_DOMAIN}`],
      );
      expect(rows[0].n).toBe(0);
    });

    it("does not echo the submitted password in a validation error", async () => {
      const response = await register({
        email: "nope",
        password: "short12",
        displayName: "X",
      });

      expect(JSON.stringify(response.body)).not.toContain("short12");
    });

    it("answers 400 for a body that is not JSON", async () => {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .set("Content-Type", "application/json")
        .send("{broken");

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /auth/login", () => {
    it("returns a session for the right credentials (200)", async () => {
      await registerBob();

      const response = await login({ email: email("bob"), password: PASSWORD });

      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body.user.email).toBe(email("bob"));
      expect(response.body.expiresIn).toBe(900);
    });

    it("accepts the email in any letter case", async () => {
      await registerBob();

      const response = await login({
        email: email("BoB").toUpperCase(),
        password: PASSWORD,
      });

      expect(response.status).toBe(200);
    });

    it("starts a new session (new token family) on every login", async () => {
      const registration = await registerBob();
      await login({ email: email("bob"), password: PASSWORD });

      const { rows } = await pool.query(
        "SELECT count(DISTINCT family_id)::int AS families FROM refresh_tokens WHERE user_id = $1",
        [registration.body.user.id],
      );
      expect(rows[0].families).toBe(2);
    });

    it("gives the identical answer for a wrong password and an unknown email", async () => {
      await registerBob();

      const wrongPassword = await login({
        email: email("bob"),
        password: "not the password",
      });
      const unknownEmail = await login({
        email: email("ghost"),
        password: "not the password",
      });

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body.error.code).toBe("INVALID_CREDENTIALS");
      expect(unknownEmail.body).toEqual(wrongPassword.body);
    });

    it("refuses password login for a social-only account (no password set)", async () => {
      await pool.query("INSERT INTO users (email, display_name) VALUES ($1, 'Social')", [
        email("social"),
      ]);

      const response = await login({ email: email("social"), password: "anything goes" });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    it("does not accept a password that matches only in its first 72 bytes", async () => {
      const long = "a".repeat(72);
      await register({ email: email("long"), password: long, displayName: "Long" });

      const response = await login({ email: email("long"), password: `${long}EXTRA` });

      expect(response.status).toBe(401);
    });

    it("answers 400 for a missing password and for unknown fields", async () => {
      const missing = await login({ email: email("bob") });
      const extra = await login({ email: email("bob"), password: "x", remember: true });

      expect(missing.status).toBe(400);
      expect(extra.status).toBe(400);
    });

    it("reports linked social accounts in the user", async () => {
      const registration = await registerBob();
      // A value of its own: other test files run in parallel and also use a Google account id,
      // and this row is COMMITTED, so a shared literal would make their inserts collide.
      await pool.query(
        "INSERT INTO oauth_identities (user_id, provider, provider_user_id) VALUES ($1, 'google', $2)",
        [
          registration.body.user.id,
          `auth-flow-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ],
      );

      const response = await login({ email: email("bob"), password: PASSWORD });

      expect(response.body.user.linkedProviders).toEqual(["google"]);
    });
  });

  describe("GET /users/me", () => {
    it("returns the signed-in user for a valid access token", async () => {
      const registration = await registerBob();

      const response = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${registration.body.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(registration.body.user);
      expect(JSON.stringify(response.body)).not.toMatch(/password|\$2b\$/i);
    });

    it("answers 401 UNAUTHENTICATED without a token", async () => {
      const response = await request(app).get("/api/v1/users/me");

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("answers 401 UNAUTHENTICATED for a garbage token", async () => {
      const response = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", "Bearer not.a.token");

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("answers 401 TOKEN_EXPIRED for an expired token", async () => {
      const registration = await registerBob();
      const old = await signAccessToken(
        registration.body.user.id,
        SECRET,
        new Date(Date.now() - 20 * 60 * 1000),
      );

      const response = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${old}`);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("TOKEN_EXPIRED");
    });

    it("answers 401 for a valid token whose user was deleted", async () => {
      const registration = await registerBob();
      await pool.query("DELETE FROM users WHERE id = $1", [registration.body.user.id]);

      const response = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${registration.body.accessToken}`);

      expect(response.status).toBe(401);
    });
  });

  describe("rate limiting (in-memory store)", () => {
    it("blocks login attempts past the limit with 429 RATE_LIMITED and Retry-After", async () => {
      await registerBob();
      const limited = buildApp({ loginLimit: { windowMs: 60_000, limit: 3 } });
      const attempt = () =>
        request(limited)
          .post("/api/v1/auth/login")
          .send({ email: email("bob"), password: "wrong one" });

      const first = await Promise.all(
        [attempt(), attempt(), attempt()].map(async (p) => (await p).status),
      );
      const blocked = await attempt();

      expect(first).toEqual([401, 401, 401]);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("RATE_LIMITED");
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    });

    it("also blocks the CORRECT password once the limit is reached", async () => {
      await registerBob();
      const limited = buildApp({ loginLimit: { windowMs: 60_000, limit: 2 } });
      const send = (password: string) =>
        request(limited)
          .post("/api/v1/auth/login")
          .send({ email: email("bob"), password });

      await send("wrong 1");
      await send("wrong 2");
      const response = await send(PASSWORD);

      expect(response.status).toBe(429);
    });

    it("limits registration separately from login", async () => {
      const limited = buildApp({
        registerLimit: { windowMs: 60_000, limit: 1 },
        loginLimit: { windowMs: 60_000, limit: 100 },
      });
      const body = { email: email("one"), password: PASSWORD, displayName: "One" };

      await request(limited).post("/api/v1/auth/register").send(body);
      const secondRegister = await request(limited)
        .post("/api/v1/auth/register")
        .send({ ...body, email: email("two") });
      const loginStillWorks = await request(limited)
        .post("/api/v1/auth/login")
        .send({ email: email("one"), password: PASSWORD });

      expect(secondRegister.status).toBe(429);
      expect(loginStillWorks.status).toBe(200);
    });
  });
});
