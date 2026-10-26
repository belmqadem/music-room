import type pg from "pg";
import type { ListCursor } from "../../list-cursor.js";

// All SQL for friendships lives here. Functions take `db` so the caller decides whether they
// run on the pool or inside a transaction.
type Queryable = Pick<pg.Pool, "query">;

export interface FriendshipRecord {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: "pending" | "accepted";
  createdAt: Date;
  respondedAt: Date | null;
}

/** A friendship as seen by one user: the other person's name and the cursor for the list. */
export interface FriendshipView extends FriendshipRecord {
  otherUserId: string;
  otherDisplayName: string;
  /** The timestamp the list is sorted by, exactly as Postgres prints it (microseconds). */
  cursorTimestamp: string;
}

interface FriendshipRow {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted";
  created_at: Date;
  responded_at: Date | null;
}

interface ViewRow extends FriendshipRow {
  other_user_id: string;
  other_display_name: string;
  cursor_timestamp: string;
}

const COLUMNS = "id, requester_id, addressee_id, status, created_at, responded_at";

function toRecord(row: FriendshipRow): FriendshipRecord {
  return {
    id: row.id,
    requesterId: row.requester_id,
    addresseeId: row.addressee_id,
    status: row.status,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
  };
}

function toView(row: ViewRow): FriendshipView {
  return {
    ...toRecord(row),
    otherUserId: row.other_user_id,
    otherDisplayName: row.other_display_name,
    cursorTimestamp: row.cursor_timestamp,
  };
}

// $1 is the user the query is run for. The other person's name is joined in one go.
const VIEW_SELECT = `
  SELECT f.id, f.requester_id, f.addressee_id, f.status, f.created_at, f.responded_at,
         u.id AS other_user_id, u.display_name AS other_display_name`;
const VIEW_JOIN = `
  FROM friendships f
  JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END`;

export async function userExists(db: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM users WHERE id = $1", [id]);
  return rowCount === 1;
}

/**
 * The friendship between two users, whoever asked first, locked until the transaction ends so
 * that two requests for the same pair are decided one after the other.
 */
export async function findPairForUpdate(
  db: Queryable,
  userA: string,
  userB: string,
): Promise<FriendshipRecord | null> {
  const { rows } = await db.query<FriendshipRow>(
    `SELECT ${COLUMNS} FROM friendships
     WHERE LEAST(requester_id, addressee_id) = LEAST($1::uuid, $2::uuid)
       AND GREATEST(requester_id, addressee_id) = GREATEST($1::uuid, $2::uuid)
     FOR UPDATE`,
    [userA, userB],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

/**
 * The request or friendship between two users, whoever asked first, or null. Not locked: the
 * profile code reads it to decide what to show (only `accepted` is friendship) and to say where
 * the caller stands.
 */
export async function findPair(
  db: Queryable,
  userA: string,
  userB: string,
): Promise<FriendshipRecord | null> {
  const { rows } = await db.query<FriendshipRow>(
    `SELECT ${COLUMNS} FROM friendships
     WHERE LEAST(requester_id, addressee_id) = LEAST($1::uuid, $2::uuid)
       AND GREATEST(requester_id, addressee_id) = GREATEST($1::uuid, $2::uuid)`,
    [userA, userB],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

/** @throws a unique violation (friendships_pair_key) if the pair already has a row. */
export async function insertRequest(
  db: Queryable,
  requesterId: string,
  addresseeId: string,
): Promise<FriendshipRecord> {
  const { rows } = await db.query<FriendshipRow>(
    `INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2) RETURNING ${COLUMNS}`,
    [requesterId, addresseeId],
  );
  return toRecord(rows[0]!);
}

/**
 * Accepts a pending request addressed to `addresseeId`. ONE statement, so of two simultaneous
 * accepts exactly one matches; null when nothing matched (look at findById to learn why).
 */
export async function acceptRequest(
  db: Queryable,
  id: string,
  addresseeId: string,
): Promise<FriendshipRecord | null> {
  const { rows } = await db.query<FriendshipRow>(
    `UPDATE friendships SET status = 'accepted', responded_at = now()
     WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
     RETURNING ${COLUMNS}`,
    [id, addresseeId],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

/** Accepts a pending request by its id, whoever the addressee is (the caller already checked who). */
export async function acceptPendingById(
  db: Queryable,
  id: string,
): Promise<FriendshipRecord | null> {
  const { rows } = await db.query<FriendshipRow>(
    `UPDATE friendships SET status = 'accepted', responded_at = now()
     WHERE id = $1 AND status = 'pending' RETURNING ${COLUMNS}`,
    [id],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function findById(
  db: Queryable,
  id: string,
): Promise<FriendshipRecord | null> {
  const { rows } = await db.query<FriendshipRow>(
    `SELECT ${COLUMNS} FROM friendships WHERE id = $1`,
    [id],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

/**
 * Declines or cancels a PENDING request that `userId` is part of. Returns whether one was
 * removed. An accepted friendship is not removed here (that is unfriending).
 */
export async function deletePendingRequest(
  db: Queryable,
  id: string,
  userId: string,
): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM friendships
     WHERE id = $1 AND status = 'pending' AND (requester_id = $2 OR addressee_id = $2)`,
    [id, userId],
  );
  return result.rowCount === 1;
}

/** Unfriends: removes the ACCEPTED friendship between two users. Returns whether one was removed. */
export async function deleteFriendship(
  db: Queryable,
  userA: string,
  userB: string,
): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM friendships
     WHERE status = 'accepted'
       AND LEAST(requester_id, addressee_id) = LEAST($1::uuid, $2::uuid)
       AND GREATEST(requester_id, addressee_id) = GREATEST($1::uuid, $2::uuid)`,
    [userA, userB],
  );
  return result.rowCount === 1;
}

/** The friendship with its other person, as seen by `userId`. */
export async function viewOf(
  db: Queryable,
  id: string,
  userId: string,
): Promise<FriendshipView | null> {
  const { rows } = await db.query<ViewRow>(
    `${VIEW_SELECT},
            (CASE WHEN f.status = 'accepted' THEN f.responded_at ELSE f.created_at END)::text
              AS cursor_timestamp
     ${VIEW_JOIN}
     WHERE f.id = $2`,
    [userId, id],
  );
  return rows[0] ? toView(rows[0]) : null;
}

/** The user's friends, most recently accepted first. Up to `limit` rows (the caller asks for one extra). */
export async function listFriends(
  db: Queryable,
  userId: string,
  options: { limit: number; after?: ListCursor | undefined },
): Promise<FriendshipView[]> {
  const { rows } = await db.query<ViewRow>(
    `${VIEW_SELECT}, f.responded_at::text AS cursor_timestamp
     ${VIEW_JOIN}
     WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1)
       AND ($2::timestamptz IS NULL OR (f.responded_at, f.id) < ($2::timestamptz, $3::uuid))
     ORDER BY f.responded_at DESC, f.id DESC
     LIMIT $4`,
    [userId, options.after?.createdAt ?? null, options.after?.id ?? null, options.limit],
  );
  return rows.map(toView);
}

/** The user's pending requests in one direction, newest first. */
export async function listPendingRequests(
  db: Queryable,
  userId: string,
  direction: "incoming" | "outgoing",
  options: { limit: number; after?: ListCursor | undefined },
): Promise<FriendshipView[]> {
  const mine = direction === "incoming" ? "f.addressee_id" : "f.requester_id";
  const { rows } = await db.query<ViewRow>(
    `${VIEW_SELECT}, f.created_at::text AS cursor_timestamp
     ${VIEW_JOIN}
     WHERE f.status = 'pending' AND ${mine} = $1
       AND ($2::timestamptz IS NULL OR (f.created_at, f.id) < ($2::timestamptz, $3::uuid))
     ORDER BY f.created_at DESC, f.id DESC
     LIMIT $4`,
    [userId, options.after?.createdAt ?? null, options.after?.id ?? null, options.limit],
  );
  return rows.map(toView);
}
