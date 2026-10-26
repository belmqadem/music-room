import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Integration tests for the auth tables (users, oauth_identities, refresh_tokens).
// They need a migrated database: set TEST_DATABASE_URL (see `make test-integration`),
// otherwise the whole file is skipped. Each test runs inside a transaction that is
// rolled back, so no data is left behind. Because a failed statement aborts a
// Postgres transaction, a test that expects an error has exactly one failing
// statement, and it is the last one.
const databaseUrl = process.env.TEST_DATABASE_URL;

const PG_UNIQUE_VIOLATION = "23505";
const PG_CHECK_VIOLATION = "23514";
const PG_FOREIGN_KEY_VIOLATION = "23503";

const validHash = "a".repeat(64);

describe.skipIf(!databaseUrl)("auth schema constraints", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function insertUser(
    email: string | null,
    displayName = `test ${Math.random()}`,
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      "INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id",
      [email, displayName],
    );
    return result.rows[0]!.id;
  }

  async function expectPgError(statement: Promise<unknown>, code: string): Promise<void> {
    await expect(statement).rejects.toMatchObject({ code });
  }

  describe("users", () => {
    it("rejects the same email with different letter case", async () => {
      await insertUser("Bob@Example.com");

      await expectPgError(insertUser("bob@example.com"), PG_UNIQUE_VIOLATION);
    });

    it("allows many users without an email (social-only accounts)", async () => {
      await insertUser(null);
      await insertUser(null);

      const { rows } = await client.query(
        "SELECT count(*)::int AS n FROM users WHERE email IS NULL",
      );
      expect(rows[0].n).toBeGreaterThanOrEqual(2);
    });

    it("rejects a password account that has no email", async () => {
      await expectPgError(
        client.query(
          "INSERT INTO users (password_hash, display_name) VALUES ('hash', 'noemail' || md5(random()::text))",
        ),
        PG_CHECK_VIOLATION,
      );
    });

    it("accepts a social-only account (no password, no email)", async () => {
      await expect(insertUser(null, "Social Only")).resolves.toBeTypeOf("string");
    });

    it("rejects an empty display name", async () => {
      await expectPgError(insertUser("a@example.com", ""), PG_CHECK_VIOLATION);
    });

    it("rejects a display name longer than 50 characters", async () => {
      await expectPgError(
        insertUser("a@example.com", "x".repeat(51)),
        PG_CHECK_VIOLATION,
      );
    });

    it("rejects an empty email string", async () => {
      await expectPgError(insertUser(""), PG_CHECK_VIOLATION);
    });
  });

  describe("oauth_identities", () => {
    const link = (userId: string, provider: string, providerUserId: string) =>
      client.query(
        "INSERT INTO oauth_identities (user_id, provider, provider_user_id) VALUES ($1, $2, $3)",
        [userId, provider, providerUserId],
      );

    it("rejects linking the same social account to two different users", async () => {
      const first = await insertUser("one@example.com");
      const second = await insertUser("two@example.com");
      await link(first, "google", "google-123");

      await expectPgError(link(second, "google", "google-123"), PG_UNIQUE_VIOLATION);
    });

    it("rejects a second account of the same provider for one user", async () => {
      const user = await insertUser("one@example.com");
      await link(user, "google", "google-1");

      await expectPgError(link(user, "google", "google-2"), PG_UNIQUE_VIOLATION);
    });

    it("allows one user to link both Google and Facebook", async () => {
      const user = await insertUser("one@example.com");
      await link(user, "google", "google-1");

      await expect(link(user, "facebook", "fb-1")).resolves.toBeDefined();
    });

    it("allows the same provider id string on different providers", async () => {
      const first = await insertUser("one@example.com");
      const second = await insertUser("two@example.com");
      await link(first, "google", "42");

      await expect(link(second, "facebook", "42")).resolves.toBeDefined();
    });

    it("rejects an unknown provider", async () => {
      const user = await insertUser("one@example.com");

      await expectPgError(link(user, "twitter", "t-1"), PG_CHECK_VIOLATION);
    });

    it("rejects a link to a user that does not exist", async () => {
      await expectPgError(
        link("00000000-0000-4000-8000-000000000000", "google", "g-1"),
        PG_FOREIGN_KEY_VIOLATION,
      );
    });
  });

  describe("refresh_tokens", () => {
    const insertToken = (userId: string, hash: string) =>
      client.query(
        `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
         VALUES ($1, gen_random_uuid(), $2, now() + interval '7 days')`,
        [userId, hash],
      );

    it("rejects two tokens with the same hash", async () => {
      const user = await insertUser("one@example.com");
      await insertToken(user, validHash);

      await expectPgError(insertToken(user, validHash), PG_UNIQUE_VIOLATION);
    });

    it("rejects a hash that is not 64 characters (not a SHA-256 hex digest)", async () => {
      const user = await insertUser("one@example.com");

      await expectPgError(insertToken(user, "too-short"), PG_CHECK_VIOLATION);
    });

    it("rejects a token for a user that does not exist", async () => {
      await expectPgError(
        insertToken("00000000-0000-4000-8000-000000000000", validHash),
        PG_FOREIGN_KEY_VIOLATION,
      );
    });

    it("starts a token unused and unrevoked", async () => {
      const user = await insertUser("one@example.com");
      await insertToken(user, validHash);

      const { rows } = await client.query(
        "SELECT used_at, revoked_at FROM refresh_tokens WHERE token_hash = $1",
        [validHash],
      );
      expect(rows[0]).toEqual({ used_at: null, revoked_at: null });
    });
  });

  describe("deleting a user", () => {
    it("also deletes their linked accounts and refresh tokens", async () => {
      const user = await insertUser("one@example.com");
      await client.query(
        "INSERT INTO oauth_identities (user_id, provider, provider_user_id) VALUES ($1, 'google', 'g-1')",
        [user],
      );
      await client.query(
        `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
         VALUES ($1, gen_random_uuid(), $2, now() + interval '7 days')`,
        [user, validHash],
      );

      await client.query("DELETE FROM users WHERE id = $1", [user]);

      const identities = await client.query(
        "SELECT 1 FROM oauth_identities WHERE user_id = $1",
        [user],
      );
      const tokens = await client.query(
        "SELECT 1 FROM refresh_tokens WHERE user_id = $1",
        [user],
      );
      expect(identities.rowCount).toBe(0);
      expect(tokens.rowCount).toBe(0);
    });
  });
});
