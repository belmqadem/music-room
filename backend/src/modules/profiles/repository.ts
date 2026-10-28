import type pg from "pg";
import type { UpdateProfileInput } from "./schema.js";
import type { ProfileRecord } from "./visibility.js";

type Queryable = Pick<pg.Pool, "query">;

/** The user joined with their profile row, which may not exist yet. Null when the user does not. */
export async function findProfileRecord(
  db: Queryable,
  userId: string,
): Promise<ProfileRecord | null> {
  const { rows } = await db.query(
    `SELECT u.id, u.display_name, p.bio, p.full_name, p.city, p.phone,
            to_char(p.birth_date, 'YYYY-MM-DD') AS birth_date, p.genres
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.id,
    displayName: row.display_name,
    bio: row.bio ?? null,
    fullName: row.full_name ?? null,
    city: row.city ?? null,
    phone: row.phone ?? null,
    birthDate: row.birth_date ?? null,
    genres: row.genres ?? [],
  };
}

// The columns a PATCH may touch, by API field. Column names come from THIS table, never from the
// request, so building the statement from the keys that were sent cannot inject anything.
function changedColumns(
  input: UpdateProfileInput,
): Array<[column: string, value: unknown]> {
  const entries: Array<[string, unknown]> = [
    ["bio", input.publicInfo?.bio],
    ["full_name", input.friendsInfo?.fullName],
    ["city", input.friendsInfo?.city],
    ["phone", input.privateInfo?.phone],
    ["birth_date", input.privateInfo?.birthDate],
    ["genres", input.musicPreferences?.genres],
  ];
  // undefined = not sent (keep); null = sent to clear.
  return entries.filter(([, value]) => value !== undefined);
}

/**
 * Creates the row on first use and changes only the fields that were sent, in ONE statement:
 * two simultaneous PATCHes cannot collide on the insert, and neither overwrites fields it did
 * not send. Returns false when there was nothing to change.
 */
export async function upsertProfile(
  db: Queryable,
  userId: string,
  input: UpdateProfileInput,
): Promise<boolean> {
  const changes = changedColumns(input);
  if (changes.length === 0) return false;
  const columns = changes.map(([column]) => column);
  const placeholders = changes.map((_, index) => `$${index + 2}`);
  const assignments = columns.map((column) => `${column} = EXCLUDED.${column}`);
  await db.query(
    `INSERT INTO profiles (user_id, ${columns.join(", ")})
     VALUES ($1, ${placeholders.join(", ")})
     ON CONFLICT (user_id) DO UPDATE SET ${assignments.join(", ")}, updated_at = now()`,
    [userId, ...changes.map(([, value]) => value)],
  );
  return true;
}
