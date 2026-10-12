import pg from "pg";

/**
 * Creates a Postgres connection pool. Creating the pool does not connect;
 * connections are opened on first query. Callers own the pool and must call
 * `pool.end()` on shutdown.
 */
export function createPostgresPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl });
}

/** Fails (throws) if the database is unreachable. Used for fail-fast startup. */
export async function assertPostgresReachable(pool: pg.Pool): Promise<void> {
  await pool.query("SELECT 1");
}

// Postgres aborts one transaction of a deadlock on purpose and says so with this
// code; "serialization failure" is the same idea for stricter isolation levels.
// Both mean "nothing was wrong with your request, just run it again".
const DEADLOCK_DETECTED = "40P01";
const SERIALIZATION_FAILURE = "40001";
const MAX_ATTEMPTS = 3;

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === DEADLOCK_DETECTED || code === SERIALIZATION_FAILURE;
}

export interface TransactionOptions {
  /** Tests only: replaces the short random pause before a retry. */
  retryDelayMs?: () => number;
}

async function runOnce<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Runs `work` inside one database transaction on a dedicated connection:
 * COMMIT if it returns, ROLLBACK (and rethrow) if it throws. Use it whenever
 * several statements must succeed or fail together.
 *
 * If Postgres picks this transaction as the victim of a deadlock, the whole
 * transaction was rolled back, so it is run again (up to 3 attempts, after a
 * short random pause so the competitors do not collide again in step).
 * For that reason `work` must only touch the database: it may run more than
 * once, and anything it did outside the database would be repeated.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await runOnce(pool, work);
    } catch (error) {
      if (!isRetryable(error) || attempt >= MAX_ATTEMPTS) throw error;
      const pauseMs = options.retryDelayMs
        ? options.retryDelayMs()
        : 5 + Math.random() * 20;
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }
}
