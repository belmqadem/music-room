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

/** Which unique constraint a violation was about (null for other errors). */
export function violatedConstraint(error: unknown): string | null {
  if (!isUniqueViolation(error)) return null;
  return (error as { constraint?: string }).constraint ?? null;
}

/** Postgres error code for a FOREIGN KEY violation (here: the user was deleted). */
export function isForeignKeyViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23503";
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

/** The user a provider account is linked to, if any. */
export async function findUserByIdentity(
  db: Queryable,
  provider: string,
  providerUserId: string,
): Promise<UserRecord | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT u.id, u.email, u.password_hash, u.display_name, u.created_at
     FROM oauth_identities i JOIN users u ON u.id = i.user_id
     WHERE i.provider = $1 AND i.provider_user_id = $2`,
    [provider, providerUserId],
  );
  return rows[0] ? toUserRecord(rows[0]) : null;
}

/**
 * Locks the user's row until the transaction ends. Used to serialize changes
 * to a user's login methods, so two simultaneous unlinks cannot both pass the
 * "keep at least one login method" check.
 */
export async function lockUser(db: Queryable, id: string): Promise<UserRecord | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] ? toUserRecord(rows[0]) : null;
}

/** A social-only account: no password. @throws unique violation if the email is taken. */
export async function insertSocialUser(
  db: Queryable,
  user: { email: string | null; displayName: string },
): Promise<UserRecord> {
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING ${USER_COLUMNS}`,
    [user.email, user.displayName],
  );
  return toUserRecord(rows[0]!);
}

/**
 * @throws a unique violation when the provider account is already linked
 * (to anyone) or this user already has that provider; a foreign-key
 * violation when the user no longer exists.
 */
export async function insertOAuthIdentity(
  db: Queryable,
  identity: { userId: string; provider: string; providerUserId: string },
): Promise<void> {
  await db.query(
    "INSERT INTO oauth_identities (user_id, provider, provider_user_id) VALUES ($1, $2, $3)",
    [identity.userId, identity.provider, identity.providerUserId],
  );
}

/** Returns whether a link was removed. */
export async function deleteOAuthIdentity(
  db: Queryable,
  userId: string,
  provider: string,
): Promise<boolean> {
  const result = await db.query(
    "DELETE FROM oauth_identities WHERE user_id = $1 AND provider = $2",
    [userId, provider],
  );
  return result.rowCount === 1;
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

export interface RefreshTokenRecord {
  userId: string;
  familyId: string;
  usedAt: Date | null;
}

/**
 * Atomically consumes a refresh token: succeeds only if it exists, is unused,
 * not revoked and not expired. It is ONE statement, so when several requests
 * present the same token at once, Postgres lets exactly one of them match
 * (the others wait on the row lock, then see used_at already set and match
 * nothing). That is what makes rotation race-safe.
 * Returns null when the token cannot be consumed (look at findRefreshToken to learn why).
 */
export async function consumeRefreshToken(
  db: Queryable,
  tokenHash: string,
): Promise<RefreshTokenRecord | null> {
  const { rows } = await db.query<{ user_id: string; family_id: string; used_at: Date }>(
    `UPDATE refresh_tokens SET used_at = now()
     WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
     RETURNING user_id, family_id, used_at`,
    [tokenHash],
  );
  const row = rows[0];
  return row
    ? { userId: row.user_id, familyId: row.family_id, usedAt: row.used_at }
    : null;
}

export async function findRefreshToken(
  db: Queryable,
  tokenHash: string,
): Promise<RefreshTokenRecord | null> {
  const { rows } = await db.query<{
    user_id: string;
    family_id: string;
    used_at: Date | null;
  }>("SELECT user_id, family_id, used_at FROM refresh_tokens WHERE token_hash = $1", [
    tokenHash,
  ]);
  const row = rows[0];
  return row
    ? { userId: row.user_id, familyId: row.family_id, usedAt: row.used_at }
    : null;
}

/** Revokes every token of a login session (family). Idempotent. */
export async function revokeFamily(db: Queryable, familyId: string): Promise<void> {
  await db.query(
    "UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL",
    [familyId],
  );
}

/**
 * Logout: revokes the family of `tokenHash`, but ONLY if that token belongs to
 * `userId`. One statement, so a user can never revoke someone else's session
 * even when they present that person's token.
 */
export async function revokeFamilyOfUsersToken(
  db: Queryable,
  tokenHash: string,
  userId: string,
): Promise<void> {
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE revoked_at IS NULL AND family_id = (
       SELECT family_id FROM refresh_tokens WHERE token_hash = $1 AND user_id = $2
     )`,
    [tokenHash, userId],
  );
}
