import type pg from "pg";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { createAuthService } from "../../src/modules/auth/service.js";
import type { ProviderVerifiers } from "../../src/modules/auth/provider-verifier.js";

// The first social login of an account that another request is creating at the very
// same moment. Run for real, the window is a few milliseconds wide and only shows up
// under load, so here the database's answers are SCRIPTED to force that exact order:
//   1. "is this provider account linked yet?"   -> no   (the other request has not committed)
//   2. "does this email belong to someone?"     -> yes  (the other request has just committed)
//   3. "is this provider account linked yet?"   -> yes  (same commit as the user in step 2)
// The script matches the SQL text, so it must follow the repository if its queries change.
const GOOGLE_ID = "google-sub-1";
const identity = {
  providerUserId: GOOGLE_ID,
  displayName: "Ada",
  verifiedEmail: "ada@example.com",
  expiresAt: new Date(Date.now() + 3600_000),
};
const verifiers = {
  google: { verify: () => Promise.resolve(identity) },
  facebook: { verify: () => Promise.reject(new Error("not used")) },
} as unknown as ProviderVerifiers;

const userRow = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ada@example.com",
  password_hash: null,
  display_name: "Ada",
  created_at: new Date("2026-10-12T20:00:00Z"),
  email_verified_at: new Date("2026-10-12T20:00:00Z"),
};

/** A pool whose transactions answer from a script. `identityLookups` are consumed in order. */
function scriptedPool(identityLookups: Record<string, unknown>[][], emailOwner: boolean) {
  const statements: string[] = [];
  const remaining = [...identityLookups];
  const client = {
    query(sql: string) {
      statements.push(sql);
      if (sql.includes("FROM oauth_identities i JOIN users u")) {
        return Promise.resolve({ rows: remaining.shift() ?? [] });
      }
      if (sql.includes("lower(email) = lower")) {
        return Promise.resolve({ rows: emailOwner ? [userRow] : [] });
      }
      // The credential's first use (ADR-047): this test is about the race, not about replay.
      if (sql.includes("INSERT INTO used_provider_credentials")) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (sql.includes("SELECT provider FROM oauth_identities")) {
        return Promise.resolve({ rows: [{ provider: "google" }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 }); // BEGIN, COMMIT, ROLLBACK, INSERT INTO refresh_tokens
    },
    release() {},
  };
  const pool = {
    connect: () => Promise.resolve(client),
    query: client.query,
  } as unknown as pg.Pool;
  return { pool, statements };
}

const serviceOver = (pool: pg.Pool) =>
  createAuthService({
    pool,
    jwtSecret: "s".repeat(32),
    logger: pino({ level: "silent" }),
    verifiers,
    mailer: { send: () => Promise.resolve() },
    passwordCost: 4,
  });

describe("first social login racing the creation of the same account", () => {
  it("logs in as the account the other request just created, instead of refusing with EMAIL_TAKEN", async () => {
    const { pool, statements } = scriptedPool([[], [userRow]], true);

    const session = await serviceOver(pool).oauthLogin("google", { credential: "token" });

    expect(session.user.id).toBe(userRow.id);
    expect(session.user.linkedProviders).toEqual(["google"]);
    expect(statements.some((sql) => sql.includes("INSERT INTO users"))).toBe(false);
  });

  it("still refuses when the email belongs to a DIFFERENT account (no automatic linking)", async () => {
    // The provider account is not linked at either look: the email owner is someone else.
    const { pool, statements } = scriptedPool([[], []], true);

    await expect(
      serviceOver(pool).oauthLogin("google", { credential: "token" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "EMAIL_TAKEN",
    });
    expect(statements.some((sql) => sql.includes("INSERT INTO users"))).toBe(false);
  });
});
