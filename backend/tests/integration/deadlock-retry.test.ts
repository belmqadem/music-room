import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool, withTransaction } from "../../src/db/postgres.js";

// A REAL deadlock, made on demand: two transactions each lock one row, wait until the
// other has done the same, then reach for the other's row. Postgres detects the cycle
// and aborts one of them (error 40P01). withTransaction must run the victim again, so
// both end up committed. Needs a migrated database (set TEST_DATABASE_URL).
const databaseUrl = process.env.TEST_DATABASE_URL;
const NAME_PREFIX = "deadlock-test-";

describe.skipIf(!databaseUrl)("withTransaction against a real deadlock", () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = createPostgresPool(databaseUrl!);
  });
  afterEach(async () => {
    await pool.query("DELETE FROM users WHERE display_name LIKE $1", [`${NAME_PREFIX}%`]);
  });
  afterAll(async () => {
    await pool.end();
  });

  async function makeUser(name: string): Promise<string> {
    const { rows } = await pool.query(
      "INSERT INTO users (display_name) VALUES ($1) RETURNING id",
      [`${NAME_PREFIX}${name}`],
    );
    return rows[0].id;
  }
  const deadlockCount = async () =>
    Number(
      (
        await pool.query(
          "SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()",
        )
      ).rows[0].deadlocks,
    );

  it("retries the transaction Postgres chose as the victim, so both succeed", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const before = await deadlockCount();

    // Each worker, on its FIRST attempt only, waits until both hold their first lock.
    let bothHoldFirstLock: () => void;
    const barrier = new Promise<void>((resolve) => (bothHoldFirstLock = resolve));
    let waiting = 0;
    const attempts = { one: 0, two: 0 };

    const worker = (key: "one" | "two", first: string, second: string) =>
      withTransaction(pool, async (client) => {
        attempts[key]++;
        await client.query("UPDATE users SET display_name = display_name WHERE id = $1", [
          first,
        ]);
        if (attempts[key] === 1) {
          if (++waiting === 2) bothHoldFirstLock();
          await barrier;
        }
        await client.query("UPDATE users SET display_name = display_name WHERE id = $1", [
          second,
        ]);
        return key;
      });

    const results = await Promise.all([worker("one", a, b), worker("two", b, a)]);

    expect(results).toEqual(["one", "two"]);
    expect(attempts.one + attempts.two).toBe(3); // exactly one of them ran twice
    expect((await deadlockCount()) - before).toBe(1); // and Postgres really did detect a deadlock
  });
});
