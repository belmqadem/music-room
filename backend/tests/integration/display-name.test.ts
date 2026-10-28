import { randomBytes } from "node:crypto";
import type { Express } from "express";
import pg from "pg";
import pino from "pino";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";
import { createMemoryMailer } from "../helpers/memory-mailer.js";
import { signUpVerified, withDisplayName } from "../helpers/sign-up.js";

// Unique display names (ADR-046) against a real, migrated Postgres (set TEST_DATABASE_URL).
// Rules under test: a new account has a temporary name and is refused everywhere but /users/me,
// choosing a name and signing out; a name is trimmed, lowercased and checked; it is unique
// ignoring case, also when chosen at the same moment; it can be changed, which frees the old one.
const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(32);
const EMAIL_DOMAIN = "@display-name.invalid";
const PASSWORD = "Correct-Horse-Battery-9";
// Names unique to this run, so parallel test files and leftovers never collide.
const RUN = `d${randomBytes(4).toString("hex")}`;

interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string; displayName: string; displayNameSet: boolean };
}

describe.skipIf(!databaseUrl)("display names", () => {
  let pool: pg.Pool;
  let app: Express;
  const mailer = createMemoryMailer();
  let count = 0;

  beforeAll(() => {
    pool = createPostgresPool(databaseUrl!);
    app = createApp({
      pool,
      jwtSecret: SECRET,
      logger: pino({ level: "silent" }),
      passwordCost: 4,
      mailer,
      loginLimit: { windowMs: 60_000, limit: 10_000 },
      registerLimit: { windowMs: 60_000, limit: 10_000 },
      refreshLimit: { windowMs: 60_000, limit: 10_000 },
      emailCodeLimit: { windowMs: 60_000, limit: 10_000 },
    });
  });
  afterEach(async () => {
    await pool.query("DELETE FROM users WHERE email LIKE $1", [`%${EMAIL_DOMAIN}`]);
  });
  afterAll(async () => {
    await pool.end();
  });

  /** A verified account that has not chosen its name yet: what the app has after sign-up. */
  async function newAccount(): Promise<Session> {
    count += 1;
    const response = await signUpVerified(
      app,
      mailer,
      { email: `user${count}${EMAIL_DOMAIN}`, password: PASSWORD },
      { chooseName: false },
    );
    return response.body as Session;
  }
  const choose = (session: Session, displayName: unknown) =>
    request(app)
      .put("/api/v1/users/me/display-name")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .send({ displayName });
  const as = (session: Session, method: "get" | "post", path: string) =>
    request(app)
      [method](`/api/v1${path}`)
      .set("Authorization", `Bearer ${session.accessToken}`);

  describe("before a name is chosen", () => {
    it("the new account has a temporary name, marked not chosen", async () => {
      const session = await newAccount();

      expect(session.user.displayName).toMatch(/^user_[0-9a-f]{12}$/);
      expect(session.user.displayNameSet).toBe(false);
    });

    it("is refused everywhere with 403 DISPLAY_NAME_REQUIRED", async () => {
      const session = await newAccount();

      for (const path of ["/friends", "/events", "/playlists", "/users/me/profile"]) {
        const response = await as(session, "get", path);
        expect(response.status, path).toBe(403);
        expect(response.body.error.code, path).toBe("DISPLAY_NAME_REQUIRED");
      }
      const search = await as(session, "get", `/users?query=${RUN}`);
      expect(search.body.error.code).toBe("DISPLAY_NAME_REQUIRED");
    });

    it("may still read itself, choose a name and sign out", async () => {
      const session = await newAccount();

      expect((await as(session, "get", "/users/me")).status).toBe(200);
      expect((await choose(session, `${RUN}a`)).status).toBe(200);
      const signedOut = await as(session, "post", "/auth/logout").send({
        refreshToken: session.refreshToken,
      });
      expect(signedOut.status).toBe(204);
    });
  });

  describe("PUT /users/me/display-name", () => {
    it("trims and lowercases the name, marks it chosen, and /users/me says so", async () => {
      const session = await newAccount();

      const response = await choose(session, `  ${RUN.toUpperCase()}.Ada_1 `);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: session.user.id,
        displayName: `${RUN}.ada_1`,
        displayNameSet: true,
      });
      expect((await as(session, "get", "/users/me")).body.displayName).toBe(
        `${RUN}.ada_1`,
      );
    });

    it("the token after a refresh lets the account in everywhere", async () => {
      const session = await newAccount();
      await choose(session, `${RUN}b`);

      const refreshed = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: session.refreshToken });

      expect(refreshed.body.user.displayNameSet).toBe(true);
      expect((await as(refreshed.body, "get", "/friends")).status).toBe(200);
      // The old token still says "not chosen" until it expires: the app refreshes right away.
      expect((await as(session, "get", "/friends")).status).toBe(403);
    });

    it("answers 409 DISPLAY_NAME_TAKEN for a name someone has, whatever its case", async () => {
      const first = await newAccount();
      const second = await newAccount();
      await choose(first, `${RUN}c`);

      const response = await choose(second, ` ${RUN.toUpperCase()}C `);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("DISPLAY_NAME_TAKEN");
      expect((await as(second, "get", "/users/me")).body.displayNameSet).toBe(false);
    });

    it("gives the name to exactly one of 8 accounts choosing it at the same moment", async () => {
      const accounts = await Promise.all(Array.from({ length: 8 }, () => newAccount()));

      const answers = await Promise.all(
        accounts.map((session) => choose(session, `${RUN}d`)),
      );

      expect(answers.filter((r) => r.status === 200)).toHaveLength(1);
      expect(answers.filter((r) => r.status === 409)).toHaveLength(7);
      const { rows } = await pool.query(
        "SELECT count(*)::int AS n FROM users WHERE lower(display_name) = $1",
        [`${RUN}d`],
      );
      expect(rows[0].n).toBe(1);
    });

    it("can change the name later, which frees the old one", async () => {
      const first = await newAccount();
      const second = await newAccount();
      await choose(first, `${RUN}e`);

      expect((await choose(first, `${RUN}f`)).body.displayName).toBe(`${RUN}f`);
      expect((await choose(second, `${RUN}e`)).status).toBe(200);
    });

    it("choosing your own current name again is fine", async () => {
      const session = await newAccount();
      await choose(session, `${RUN}g`);

      expect((await choose(session, `${RUN}G`)).status).toBe(200);
    });

    it.each([
      ["too short", "ab"],
      ["too long", "a".repeat(21)],
      ["starting with a digit", "1abc"],
      ["with a space", "ada lovelace"],
      ["with a dash", "ada-l"],
      ["with an accent", "élodie"],
      ["with the prefix of temporary names", "user_000000000000"],
      ["not a string", 42],
    ])("answers 400 VALIDATION_ERROR for a name %s", async (_label, name) => {
      const session = await newAccount();

      const response = await choose(session, name);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("refuses an unknown field: a body cannot name another user", async () => {
      const session = await newAccount();
      const other = await newAccount();

      const response = await request(app)
        .put("/api/v1/users/me/display-name")
        .set("Authorization", `Bearer ${session.accessToken}`)
        .send({ displayName: `${RUN}h`, userId: other.user.id });

      expect(response.status).toBe(400);
    });

    it("requires authentication", async () => {
      const response = await request(app)
        .put("/api/v1/users/me/display-name")
        .send({ displayName: `${RUN}i` });

      expect(response.status).toBe(401);
    });
  });

  it("a chosen name is found by search; a temporary one never is", async () => {
    const searcher = (await withDisplayName(app, await newAccount(), `${RUN}searcher`))
      .body as Session;
    const named = await newAccount();
    await choose(named, `${RUN}named`);
    const unnamed = await newAccount();

    const byChosen = await as(searcher, "get", `/users?query=${RUN}named`);
    const byTemporary = await as(
      searcher,
      "get",
      `/users?query=${encodeURIComponent(unnamed.user.displayName)}`,
    );

    expect(byChosen.body.items.map((u: { id: string }) => u.id)).toEqual([named.user.id]);
    expect(byTemporary.body.items).toEqual([]);
  });
});
