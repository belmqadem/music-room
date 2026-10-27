import type pg from "pg";

// All SQL for the auth tables lives here. Functions take `db` so the caller
// decides whether they run on the pool or inside a transaction (PoolClient).
type Queryable = Pick<pg.Pool, "query">;

export interface UserRecord {
  id: string;
  email: string | null;
  passwordHash: string | null;
  displayName: string;
  /** False until the user chose their display name (ADR-046); the name is temporary until then. */
  displayNameSet: boolean;
  /** Free or Premium (ADR-048). */
  plan: "free" | "premium";
  createdAt: Date;
  /** When the email address was proven to belong to the user; null = never. */
  emailVerifiedAt: Date | null;
}

interface UserRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  display_name: string;
  display_name_set: boolean;
  plan: "free" | "premium";
  created_at: Date;
  email_verified_at: Date | null;
}

const USER_COLUMNS =
  "id, email, password_hash, display_name, display_name_set, plan, created_at, email_verified_at";

/**
 * A new account's temporary display name (ADR-046): `user_` and the first 12 hex digits of its
 * random id, computed by Postgres in the same INSERT. Chosen names may not start with `user_`,
 * so only two new accounts could collide (48 random bits); the unique index refuses that.
 */
const NEW_USER = `SELECT gen_random_uuid() AS id`;
const TEMPORARY_NAME = `'user_' || substr(replace(n.id::text, '-', ''), 1, 12)`;

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    displayNameSet: row.display_name_set,
    plan: row.plan,
    createdAt: row.created_at,
    emailVerifiedAt: row.email_verified_at,
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
  user: { email: string; passwordHash: string },
): Promise<UserRecord> {
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (id, email, password_hash, display_name)
     SELECT n.id, $1, $2, ${TEMPORARY_NAME} FROM (${NEW_USER}) n
     RETURNING ${USER_COLUMNS}`,
    [user.email, user.passwordHash],
  );
  return toUserRecord(rows[0]!);
}

/**
 * Sets the chosen display name (already checked and lowercased) and marks it chosen. Null when
 * the user no longer exists. @throws a unique violation (users_display_name_lower_key) if taken.
 */
export async function updateDisplayName(
  db: Queryable,
  id: string,
  displayName: string,
): Promise<UserRecord | null> {
  const { rows } = await db.query<UserRow>(
    `UPDATE users SET display_name = $2, display_name_set = true WHERE id = $1
     RETURNING ${USER_COLUMNS}`,
    [id, displayName],
  );
  return rows[0] ? toUserRecord(rows[0]) : null;
}

/** The user a provider account is linked to, if any. */
export async function findUserByIdentity(
  db: Queryable,
  provider: string,
  providerUserId: string,
): Promise<UserRecord | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT u.id, u.email, u.password_hash, u.display_name, u.display_name_set, u.plan,
            u.created_at, u.email_verified_at
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

/**
 * A social-only account: no password. `emailVerified` is true only when the provider vouched
 * for the email. @throws unique violation if the email is taken.
 */
export async function insertSocialUser(
  db: Queryable,
  user: { email: string | null; emailVerified: boolean },
): Promise<UserRecord> {
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (id, email, display_name, email_verified_at)
     SELECT n.id, $1, ${TEMPORARY_NAME}, CASE WHEN $2 THEN now() END FROM (${NEW_USER}) n
     RETURNING ${USER_COLUMNS}`,
    [user.email, user.emailVerified],
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

/**
 * Removes the account holding `email` ONLY if its email was never verified, and returns whether
 * one was removed. Used when a provider proves it owns that address: an unverified account
 * could never log in, so it cannot own anything, and it must not keep the real owner out.
 */
export async function deleteUnverifiedUserByEmail(
  db: Queryable,
  email: string,
): Promise<boolean> {
  const result = await db.query(
    "DELETE FROM users WHERE lower(email) = lower($1) AND email_verified_at IS NULL",
    [email],
  );
  return result.rowCount === 1;
}

/** Sets the verification time once; a second call keeps the first date. */
export async function markEmailVerified(db: Queryable, userId: string): Promise<void> {
  await db.query(
    "UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1",
    [userId],
  );
}

export async function updatePasswordHash(
  db: Queryable,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [
    userId,
    passwordHash,
  ]);
}

/** Ends every login session of a user (all families). Used after a password reset. */
export async function revokeAllRefreshTokens(
  db: Queryable,
  userId: string,
): Promise<void> {
  await db.query(
    "UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
    [userId],
  );
}

/**
 * Stores a new code for (user, purpose), replacing any earlier one, unless the earlier one was
 * issued less than `cooldownMs` ago. Returns false when the cooldown refused it. ONE statement,
 * so two simultaneous requests cannot both issue a code.
 */
export async function upsertEmailCode(
  db: Queryable,
  code: {
    userId: string;
    purpose: string;
    codeHash: string;
    expiresAt: Date;
    cooldownMs: number;
  },
): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO email_codes (user_id, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, purpose) DO UPDATE
       SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
           attempts = 0, created_at = now()
       WHERE email_codes.created_at <= now() - ($5 * interval '1 millisecond')`,
    [code.userId, code.purpose, code.codeHash, code.expiresAt, code.cooldownMs],
  );
  return result.rowCount === 1;
}

/**
 * Counts one try against the pending code and returns its hash, or null when there is no code,
 * it expired, or its tries are used up. The count is raised BEFORE the comparison and by the
 * same statement that reads the hash, so concurrent guesses cannot exceed the limit.
 */
export async function takeEmailCodeAttempt(
  db: Queryable,
  userId: string,
  purpose: string,
  maxAttempts: number,
): Promise<string | null> {
  const { rows } = await db.query<{ code_hash: string }>(
    `UPDATE email_codes SET attempts = attempts + 1
     WHERE user_id = $1 AND purpose = $2 AND expires_at > now() AND attempts < $3
     RETURNING code_hash`,
    [userId, purpose, maxAttempts],
  );
  return rows[0]?.code_hash ?? null;
}

/** Spends a code. Returns false if it was already spent (two correct submissions at once). */
export async function deleteEmailCode(
  db: Queryable,
  userId: string,
  purpose: string,
  codeHash: string,
): Promise<boolean> {
  const result = await db.query(
    "DELETE FROM email_codes WHERE user_id = $1 AND purpose = $2 AND code_hash = $3",
    [userId, purpose, codeHash],
  );
  return result.rowCount === 1;
}

/**
 * Records the first use of a provider credential (ADR-047). False when it was used before: the
 * primary key decides, so of two simultaneous uses exactly one gets true. Expired rows go first.
 */
export async function spendProviderCredential(
  db: Queryable,
  credentialHash: string,
  expiresAt: Date,
): Promise<boolean> {
  await db.query("DELETE FROM used_provider_credentials WHERE expires_at < now()");
  const { rowCount } = await db.query(
    `INSERT INTO used_provider_credentials (credential_hash, expires_at) VALUES ($1, $2)
     ON CONFLICT (credential_hash) DO NOTHING`,
    [credentialHash, expiresAt],
  );
  return rowCount === 1;
}

/**
 * Switches the user's plan and records the switch (ADR-048), on the transaction's client: the
 * row is locked first, so two simultaneous switches run one after the other and each logs what
 * really changed. Null when the user no longer exists; the unchanged user when it is already on
 * that plan (nothing is logged then).
 */
export async function switchPlan(
  db: Queryable,
  id: string,
  plan: "free" | "premium",
  client: { platform: string; device: string; appVersion: string },
): Promise<UserRecord | null> {
  const current = await lockUser(db, id);
  if (!current || current.plan === plan) return current;
  const { rows } = await db.query<UserRow>(
    `UPDATE users SET plan = $2, plan_changed_at = now() WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [id, plan],
  );
  await db.query(
    `INSERT INTO plan_changes (user_id, from_plan, to_plan, platform, device, app_version)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, current.plan, plan, client.platform, client.device, client.appVersion],
  );
  return rows[0] ? toUserRecord(rows[0]) : null;
}
