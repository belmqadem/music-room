import type pg from "pg";

// All SQL for the auth tables lives here. Functions take `db` so the caller
// decides whether they run on the pool or inside a transaction (PoolClient).
type Queryable = Pick<pg.Pool, "query">;

export interface UserRecord {
  id: string;
  email: string | null;
  passwordHash: string | null;
  displayName: string;
  createdAt: Date;
}

interface UserRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  display_name: string;
  created_at: Date;
}

const USER_COLUMNS = "id, email, password_hash, display_name, created_at";

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

/** Postgres error code for a UNIQUE constraint violation. */
const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === UNIQUE_VIOLATION;
}

/** Looks up by lower(email) so it matches the unique index (case-insensitive). */
export async function findUserByEmail(
  db: Queryable,
  email: string,
): Promise<UserRecord | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE lower(email) = lower($1)`,
    [email],
  );
  return rows[0] ? toUserRecord(rows[0]) : null;
}

export async function findUserById(
  db: Queryable,
  id: string,
): Promise<UserRecord | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ? toUserRecord(rows[0]) : null;
}

/** @throws a Postgres unique-violation error if the email is taken (check with isUniqueViolation). */
export async function insertUser(
  db: Queryable,
  user: { email: string; passwordHash: string; displayName: string },
): Promise<UserRecord> {
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3)
     RETURNING ${USER_COLUMNS}`,
    [user.email, user.passwordHash, user.displayName],
  );
  return toUserRecord(rows[0]!);
}

export async function findLinkedProviders(
  db: Queryable,
  userId: string,
): Promise<string[]> {
  const { rows } = await db.query<{ provider: string }>(
    "SELECT provider FROM oauth_identities WHERE user_id = $1 ORDER BY provider",
    [userId],
  );
  return rows.map((row) => row.provider);
}

export async function insertRefreshToken(
  db: Queryable,
  token: { userId: string; familyId: string; tokenHash: string; expiresAt: Date },
): Promise<void> {
  await db.query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [token.userId, token.familyId, token.tokenHash, token.expiresAt],
  );
}
