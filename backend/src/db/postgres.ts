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
