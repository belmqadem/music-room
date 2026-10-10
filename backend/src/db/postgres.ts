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

/**
 * Runs `work` inside one database transaction on a dedicated connection:
 * COMMIT if it returns, ROLLBACK (and rethrow) if it throws. Use it whenever
 * several statements must succeed or fail together.
 */
export async function withTransaction<T>(
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
