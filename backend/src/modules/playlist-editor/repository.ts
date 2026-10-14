import type pg from "pg";
import type { ListCursor } from "../../list-cursor.js";
import { playlistLicenseFromColumn } from "../access/repository.js";
import type { AccessLicense, AccessResource, AccessSubject } from "../access/rules.js";

// All SQL for playlists and their invitations lives here. Functions take `db` so the
// caller decides whether they run on the pool or inside a transaction.
type Queryable = Pick<pg.Pool, "query">;

export interface PlaylistRecord {
  id: string;
  ownerId: string;
  name: string;
  visibility: "public" | "private";
  license: AccessLicense;
  createdAt: Date;
  /** created_at exactly as Postgres prints it (microseconds), for list cursors. */
  createdAtCursor: string;
  /** Whether the user the query was run for is on the invitation list. */
  isInvited: boolean;
}

export interface PlaylistValues {
  name: string;
  visibility: "public" | "private";
  license: AccessLicense;
}

interface PlaylistRow {
  id: string;
  owner_id: string;
  name: string;
  visibility: "public" | "private";
  edit_license: string;
  created_at: Date;
  created_at_cursor: string;
  is_invited: boolean;
}

// $1 is always the user the query is run for.
const PLAYLIST_SELECT = `
  p.id, p.owner_id, p.name, p.visibility, p.edit_license, p.created_at,
  p.created_at::text AS created_at_cursor,
  EXISTS (SELECT 1 FROM playlist_invitations i
          WHERE i.playlist_id = p.id AND i.user_id = $1) AS is_invited`;

function toRecord(row: PlaylistRow): PlaylistRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    visibility: row.visibility,
    license: playlistLicenseFromColumn(row.edit_license),
    createdAt: row.created_at,
    createdAtCursor: row.created_at_cursor,
    isInvited: row.is_invited,
  };
}

export async function insertPlaylist(
  db: Queryable,
  ownerId: string,
  values: PlaylistValues,
): Promise<PlaylistRecord> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO playlists (owner_id, name, visibility, edit_license)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [ownerId, values.name, values.visibility, values.license.type],
  );
  return (await findPlaylist(db, rows[0]!.id, ownerId))!;
}

/**
 * One playlist, with whether `userId` is invited. `lock` takes a row lock until the
 * transaction ends, so concurrent changes to one playlist run one after the other:
 *  - "update": for changing the playlist itself (name, visibility, license, delete);
 *  - "no-key": for editing its tracks. It still excludes every other change, but does
 *    not block unrelated rows that merely point at the playlist.
 * Anything that edits a playlist's tracks takes this lock FIRST and its entry rows after.
 *
 * The lock is its own statement and the facts are read by the NEXT one (ADR-018): a single
 * "SELECT ... FOR UPDATE" would keep an "is this user invited?" answer from before the wait.
 */
export async function findPlaylist(
  db: Queryable,
  playlistId: string,
  userId: string,
  options: { lock?: "update" | "no-key" } = {},
): Promise<PlaylistRecord | null> {
  if (options.lock) {
    await db.query(
      `SELECT 1 FROM playlists WHERE id = $1 ${options.lock === "update" ? "FOR UPDATE" : "FOR NO KEY UPDATE"}`,
      [playlistId],
    );
  }
  const { rows } = await db.query<PlaylistRow>(
    `SELECT ${PLAYLIST_SELECT} FROM playlists p WHERE p.id = $2`,
    [userId, playlistId],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

/**
 * Playlists `userId` may see, newest first: public ones, their own, and private ones they
 * are invited to. This repeats the rule of access/rules.ts `canView` in SQL, so a test
 * checks the two agree (tests/integration/playlists.test.ts). Returns up to `limit` rows;
 * the caller asks for one extra to know if there is a next page.
 */
export async function listVisiblePlaylists(
  db: Queryable,
  userId: string,
  options: { limit: number; after?: ListCursor | undefined },
): Promise<PlaylistRecord[]> {
  const { rows } = await db.query<PlaylistRow>(
    `SELECT ${PLAYLIST_SELECT}
     FROM playlists p
     WHERE (p.visibility = 'public' OR p.owner_id = $1
            OR EXISTS (SELECT 1 FROM playlist_invitations i
                       WHERE i.playlist_id = p.id AND i.user_id = $1))
       AND ($2::timestamptz IS NULL OR (p.created_at, p.id) < ($2::timestamptz, $3::uuid))
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT $4`,
    [userId, options.after?.createdAt ?? null, options.after?.id ?? null, options.limit],
  );
  return rows.map(toRecord);
}

export async function updatePlaylist(
  db: Queryable,
  playlistId: string,
  values: PlaylistValues,
): Promise<void> {
  await db.query(
    "UPDATE playlists SET name = $2, visibility = $3, edit_license = $4 WHERE id = $1",
    [playlistId, values.name, values.visibility, values.license.type],
  );
}

export async function deletePlaylist(db: Queryable, playlistId: string): Promise<void> {
  await db.query("DELETE FROM playlists WHERE id = $1", [playlistId]);
}

/** What the access engine needs to know, from a playlist row and the user who asked. */
export function accessOf(
  record: PlaylistRecord,
  userId: string,
): { resource: AccessResource; subject: AccessSubject } {
  return {
    resource: {
      ownerId: record.ownerId,
      visibility: record.visibility,
      license: record.license,
    },
    subject: { userId, isInvited: record.isInvited },
  };
}

export interface InvitationRecord {
  playlistId: string;
  userId: string;
  displayName: string;
  invitedAt: Date;
  /** invited_at exactly as Postgres prints it (microseconds), for list cursors. */
  invitedAtCursor: string;
}

interface InvitationRow {
  playlist_id: string;
  user_id: string;
  display_name: string;
  invited_at: Date;
  invited_at_cursor: string;
}

function toInvitation(row: InvitationRow): InvitationRecord {
  return {
    playlistId: row.playlist_id,
    userId: row.user_id,
    displayName: row.display_name,
    invitedAt: row.invited_at,
    invitedAtCursor: row.invited_at_cursor,
  };
}

/**
 * @throws a unique violation if the user is already invited (ALREADY_INVITED),
 * a foreign-key violation if the playlist or the user does not exist.
 */
export async function insertInvitation(
  db: Queryable,
  playlistId: string,
  userId: string,
): Promise<InvitationRecord> {
  const { rows } = await db.query<InvitationRow>(
    `WITH inserted AS (
       INSERT INTO playlist_invitations (playlist_id, user_id) VALUES ($1, $2)
       RETURNING playlist_id, user_id, invited_at
     )
     SELECT i.playlist_id, i.user_id, u.display_name, i.invited_at,
            i.invited_at::text AS invited_at_cursor
     FROM inserted i JOIN users u ON u.id = i.user_id`,
    [playlistId, userId],
  );
  return toInvitation(rows[0]!);
}

/** Invited users, newest invitation first. Up to `limit` rows (the caller asks for one extra). */
export async function listInvitations(
  db: Queryable,
  playlistId: string,
  options: { limit: number; after?: ListCursor | undefined },
): Promise<InvitationRecord[]> {
  const { rows } = await db.query<InvitationRow>(
    `SELECT i.playlist_id, i.user_id, u.display_name, i.invited_at,
            i.invited_at::text AS invited_at_cursor
     FROM playlist_invitations i JOIN users u ON u.id = i.user_id
     WHERE i.playlist_id = $1
       AND ($2::timestamptz IS NULL OR (i.invited_at, i.user_id) < ($2::timestamptz, $3::uuid))
     ORDER BY i.invited_at DESC, i.user_id DESC
     LIMIT $4`,
    [
      playlistId,
      options.after?.createdAt ?? null,
      options.after?.id ?? null,
      options.limit,
    ],
  );
  return rows.map(toInvitation);
}

export async function deleteInvitation(
  db: Queryable,
  playlistId: string,
  userId: string,
): Promise<void> {
  await db.query(
    "DELETE FROM playlist_invitations WHERE playlist_id = $1 AND user_id = $2",
    [playlistId, userId],
  );
}
