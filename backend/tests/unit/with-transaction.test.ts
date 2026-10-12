import type pg from "pg";
import { describe, expect, it } from "vitest";
import { withTransaction } from "../../src/db/postgres.js";

// withTransaction runs the work in BEGIN ... COMMIT and, if Postgres kills the
// transaction as a deadlock victim, runs the whole thing again. A scripted pool
// stands in for Postgres here; tests/integration/deadlock-retry.test.ts does it for real.
function scriptedPool() {
  const statements: string[] = [];
  let released = 0;
  const client = {
    query(sql: string) {
      statements.push(sql);
      return Promise.resolve({ rows: [] });
    },
    release() {
      released++;
    },
  };
  const pool = { connect: () => Promise.resolve(client) } as unknown as pg.Pool;
  return { pool, statements, released: () => released };
}

const pgError = (code: string) => Object.assign(new Error(`pg ${code}`), { code });
const noPause = { retryDelayMs: () => 0 };

describe("withTransaction", () => {
  it("commits and returns what the work returns", async () => {
    const { pool, statements } = scriptedPool();

    const result = await withTransaction(pool, () => Promise.resolve("done"), noPause);

    expect(result).toBe("done");
    expect(statements).toEqual(["BEGIN", "COMMIT"]);
  });

  it("rolls back and rethrows an ordinary error WITHOUT retrying", async () => {
    const { pool, statements, released } = scriptedPool();
    let attempts = 0;

    await expect(
      withTransaction(
        pool,
        () => {
          attempts++;
          return Promise.reject(new Error("boom"));
        },
        noPause,
      ),
    ).rejects.toThrowError("boom");

    expect(attempts).toBe(1);
    expect(statements).toEqual(["BEGIN", "ROLLBACK"]);
    expect(released()).toBe(1);
  });

  it.each(["40P01", "40001"])(
    "runs the whole transaction again after %s",
    async (code) => {
      const { pool, statements, released } = scriptedPool();
      let attempts = 0;

      const result = await withTransaction(
        pool,
        () => {
          attempts++;
          return attempts === 1
            ? Promise.reject(pgError(code))
            : Promise.resolve(attempts);
        },
        noPause,
      );

      expect(result).toBe(2);
      expect(statements).toEqual(["BEGIN", "ROLLBACK", "BEGIN", "COMMIT"]);
      expect(released()).toBe(2); // every attempt gives its connection back
    },
  );

  it("gives up after 3 attempts and throws the deadlock error", async () => {
    const { pool } = scriptedPool();
    let attempts = 0;

    await expect(
      withTransaction(
        pool,
        () => {
          attempts++;
          return Promise.reject(pgError("40P01"));
        },
        noPause,
      ),
    ).rejects.toMatchObject({ code: "40P01" });

    expect(attempts).toBe(3);
  });

  it.each(["23505", "23503", "42P01", "57014"])(
    "does not retry the error code %s",
    async (code) => {
      const { pool } = scriptedPool();
      let attempts = 0;

      await expect(
        withTransaction(
          pool,
          () => {
            attempts++;
            return Promise.reject(pgError(code));
          },
          noPause,
        ),
      ).rejects.toMatchObject({ code });

      expect(attempts).toBe(1);
    },
  );

  it("waits a little before retrying", async () => {
    const { pool } = scriptedPool();
    const pauses: number[] = [];
    let attempts = 0;

    await withTransaction(
      pool,
      () => (++attempts < 3 ? Promise.reject(pgError("40P01")) : Promise.resolve()),
      { retryDelayMs: () => (pauses.push(1), 1) },
    );

    expect(pauses).toHaveLength(2);
  });
});
