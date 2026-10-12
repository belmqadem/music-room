import type { Express } from "express";
import pg from "pg";
import pino from "pino";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";
import { signAccessToken } from "../../src/modules/auth/access-token.js";

// GET /users?query= against a real, migrated Postgres (set TEST_DATABASE_URL).
// Rules under test (ADR-013): case-insensitive PREFIX match on the display name,
// at least 3 characters, only { id, displayName } in the answer, never the caller,
// LIKE wildcards in the query are plain text, rate limited.
const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(32);
// Every test user's name starts with this, so cleanup never touches other data.
const RUN = `usrsrch${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!databaseUrl)("user search", () => {
  let pool: pg.Pool;
  let app: Express;

  beforeAll(() => {
    pool = createPostgresPool(databaseUrl!);
    app = createApp({ pool, jwtSecret: SECRET, logger: pino({ level: "silent" }) });
  });
  afterEach(async () => {
    await pool.query("DELETE FROM users WHERE display_name LIKE $1", [`${RUN}%`]);
  });
  afterAll(async () => {
    await pool.end();
  });

  async function makeUser(name: string, email: string | null = null) {
    const { rows } = await pool.query(
      "INSERT INTO users (display_name, email) VALUES ($1, $2) RETURNING id",
      [`${RUN}${name}`, email],
    );
    return { id: rows[0].id as string, token: await signAccessToken(rows[0].id, SECRET) };
  }
  const search = (
    user: { token: string } | null,
    query: string,
    target: Express = app,
  ) => {
    const req = request(target).get(`/api/v1/users?${query}`);
    return user ? req.set("Authorization", `Bearer ${user.token}`) : req;
  };
  const q = (text: string, extra = "") => `query=${encodeURIComponent(text)}${extra}`;

  it("requires authentication", async () => {
    const response = await search(null, q("abc"));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("finds users by the start of their display name, ignoring case", async () => {
    const me = await makeUser("-caller");
    const ada = await makeUser("-Ada Lovelace");

    const response = await search(me, q(`${RUN}-ADA`));

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.items).toEqual([
      { id: ada.id, displayName: `${RUN}-Ada Lovelace` },
    ]);
    expect(response.body.nextCursor).toBeNull();
  });

  it("matches only the START of the name, not the middle", async () => {
    const me = await makeUser("-caller");
    await makeUser("-Ada Lovelace");

    const response = await search(me, q("Lovelace"));

    expect(
      response.body.items.filter((u: { displayName: string }) =>
        u.displayName.startsWith(RUN),
      ),
    ).toEqual([]);
  });

  it("trims the query", async () => {
    const me = await makeUser("-caller");
    const grace = await makeUser("-Grace");

    const response = await search(me, q(`  ${RUN}-grace  `));

    expect(response.body.items.map((u: { id: string }) => u.id)).toEqual([grace.id]);
  });

  it("returns exactly id and displayName, never an email or other private field", async () => {
    const me = await makeUser("-caller");
    const target = await makeUser("-private-person", "secret.mail@example.com");
    await pool.query(
      "INSERT INTO oauth_identities (user_id, provider, provider_user_id) VALUES ($1, 'google', $2)",
      [target.id, `${RUN}-sub`],
    );

    const response = await search(me, q(`${RUN}-private`));

    expect(Object.keys(response.body.items[0]).sort()).toEqual(["displayName", "id"]);
    expect(JSON.stringify(response.body)).not.toContain("secret.mail");
    expect(JSON.stringify(response.body)).not.toContain("google");
  });

  it("never returns the caller", async () => {
    const me = await makeUser("-same-prefix-me");
    const other = await makeUser("-same-prefix-other");

    const response = await search(me, q(`${RUN}-same-prefix`));

    expect(response.body.items.map((u: { id: string }) => u.id)).toEqual([other.id]);
  });

  it("finds accented names whatever the case of the query", async () => {
    const me = await makeUser("-caller");
    const eloise = await makeUser("-Éloïse");

    for (const text of [`${RUN}-éloï`, `${RUN}-ÉLOÏ`]) {
      const response = await search(me, q(text));
      expect(response.body.items.map((u: { id: string }) => u.id)).toEqual([eloise.id]);
    }
  });

  it.each([
    ["no query", ""],
    ["a 2-character query", q("ab")],
    ["a blank query", q("    ")],
    ["a 51-character query", q("x".repeat(51))],
    ["a limit of 0", q("abc", "&limit=0")],
    ["a limit of 101", q("abc", "&limit=101")],
    ["a garbage cursor", q("abc", "&cursor=garbage")],
  ])("answers 400 for %s", async (_label, query) => {
    const me = await makeUser("-caller");

    const response = await search(me, query);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  describe("LIKE wildcards typed by the user are plain text", () => {
    it("treats % as a character: it cannot list everyone", async () => {
      const me = await makeUser("-caller");
      await makeUser("-pct%user");
      await makeUser("-pctXuser");

      const exact = await search(me, q(`${RUN}-pct%`));
      const onlyWildcards = await search(me, q("%%%"));

      expect(exact.body.items.map((u: { displayName: string }) => u.displayName)).toEqual(
        [`${RUN}-pct%user`],
      );
      expect(onlyWildcards.body.items).toEqual([]);
    });

    it("treats _ as a character, and a backslash as a character", async () => {
      const me = await makeUser("-caller");
      await makeUser("-und_er");
      await makeUser("-undXer");
      await makeUser("-back\\slash");

      const underscore = await search(me, q(`${RUN}-und_`));
      const onlyUnderscores = await search(me, q("___"));
      const backslash = await search(me, q(`${RUN}-back\\`));

      expect(underscore.body.items).toHaveLength(1);
      expect(onlyUnderscores.body.items).toEqual([]);
      expect(backslash.body.items).toHaveLength(1);
    });
  });

  it("treats an SQL injection attempt as text and leaves the database intact", async () => {
    const me = await makeUser("-caller");

    const response = await search(me, q("'; DROP TABLE users;--"));

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
    expect(
      Number((await pool.query("SELECT count(*) FROM users")).rows[0].count),
    ).toBeGreaterThan(0);
  });

  it("walks every page once, even with identical display names", async () => {
    const me = await makeUser("-caller");
    const created = [
      (await makeUser("-page-a")).id,
      (await makeUser("-page-b")).id,
      (await makeUser("-page-b")).id, // same name: ties break on id
      (await makeUser("-page-b")).id,
      (await makeUser("-page-c")).id,
    ];

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response: request.Response = await search(
        me,
        q(`${RUN}-page`, `&limit=2${cursor ? `&cursor=${cursor}` : ""}`),
      );
      expect(response.status).toBe(200);
      seen.push(...response.body.items.map((u: { id: string }) => u.id));
      cursor = response.body.nextCursor;
      pages++;
    } while (cursor && pages < 20);

    expect(pages).toBe(3);
    expect([...seen].sort()).toEqual([...created].sort());
    expect(new Set(seen).size).toBe(5);
    expect(seen[0]).toBe(created[0]);
    expect(seen[4]).toBe(created[4]);
  });

  it("is rate limited", async () => {
    const me = await makeUser("-caller");
    const limited = createApp({
      pool,
      jwtSecret: SECRET,
      logger: pino({ level: "silent" }),
      userSearchLimit: { windowMs: 60_000, limit: 2 },
    });

    const statuses = [];
    for (let i = 0; i < 3; i++)
      statuses.push((await search(me, q("abc"), limited)).status);

    expect(statuses).toEqual([200, 200, 429]);
  });
});
