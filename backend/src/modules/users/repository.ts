import type pg from "pg";
import type { UserSearchCursor } from "./cursor.js";

type Queryable = Pick<pg.Pool, "query">;

export interface UserSearchRow {
  id: string;
  displayName: string;
  /** lower(display_name): the sort key, kept for the page cursor. */
  sortKey: string;
}

/**
 * LIKE treats % and _ as wildcards. The search text is typed by a user, so
 * they are escaped: searching "50%" must find names starting with "50%", not everything.
 */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Users whose display name starts with `prefix`, ignoring case, never the caller.
 * Only id and display name are selected: nothing private can leak from here.
 * Up to `limit` rows (the caller asks for one extra to know if there is a next page).
 */
export async function searchUsersByDisplayNamePrefix(
  db: Queryable,
  callerId: string,
  prefix: string,
  options: { limit: number; after?: UserSearchCursor | undefined },
): Promise<UserSearchRow[]> {
  const { rows } = await db.query<{ id: string; display_name: string; sort_key: string }>(
    `SELECT id, display_name, lower(display_name) AS sort_key
     FROM users
     WHERE lower(display_name) LIKE lower($2) || '%' ESCAPE '\\'
       AND id <> $1
       -- A temporary name (ADR-046) is not a name to find someone by.
       AND display_name_set
       AND ($3::text IS NULL OR (lower(display_name), id) > ($3::text, $4::uuid))
     ORDER BY lower(display_name), id
     LIMIT $5`,
    [
      callerId,
      escapeLikePattern(prefix),
      options.after?.name ?? null,
      options.after?.id ?? null,
      options.limit,
    ],
  );
  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    sortKey: row.sort_key,
  }));
}
