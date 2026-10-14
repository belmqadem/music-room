import type pg from "pg";

// All SQL for the entries (tracks) of a playlist. Functions take `db` so the caller decides
// whether they run on the pool or inside a transaction. Everything that CHANGES the list is
// called from one transaction that first locked the playlist row (findPlaylist, lock "no-key").
//
// The order is stored as a dense integer `position`: exactly 0, 1, ... n-1, no gap (ADR-020).
// Each change below keeps it that way with one or two statements. The uniqueness of
// (playlist, position) is checked when the transaction COMMITS, so a statement may leave two
// rows on one place for a moment; the database still refuses to commit such a state.
type Queryable = Pick<pg.Pool, "query">;

/** The most entries a playlist can hold. The position range in the database enforces it too. */
export const MAX_ENTRIES = 500;

export interface EntryRecord {
  id: string;
  providerTrackId: string;
  title: string;
  artist: string;
  durationSeconds: number;
  coverUrl: string | null;
  addedBy: string;
  addedAt: Date;
}

export interface SnapshotRecord {
  version: number;
  entries: EntryRecord[];
}

interface SnapshotRow {
  version: string;
  id: string | null;
  provider_track_id: string;
  title: string;
  artist: string;
  duration_seconds: number;
  cover_url: string | null;
  added_by: string;
  added_at: Date;
}

/**
 * The playlist's tracks in order, with its version. Version and entries come from the SAME
 * statement, so they describe one moment: a version that ran ahead of its data would make
 * clients ignore the next real update. Null if the playlist does not exist.
 */
export async function readSnapshot(
  db: Queryable,
  playlistId: string,
): Promise<SnapshotRecord | null> {
  const { rows } = await db.query<SnapshotRow>(
    `SELECT p.version, e.id, e.provider_track_id, e.title, e.artist, e.duration_seconds,
            e.cover_url, e.added_by, e.added_at
     FROM playlists p
     LEFT JOIN playlist_entries e ON e.playlist_id = p.id
     WHERE p.id = $1
     ORDER BY e.position`,
    [playlistId],
  );
  const first = rows[0];
  if (!first) return null;
  return {
    version: Number(first.version), // bigint arrives as a string
    // A playlist with no entries yields one row whose entry columns are all NULL.
    entries: rows
      .filter((row) => row.id !== null)
      .map((row) => ({
        id: row.id!,
        providerTrackId: row.provider_track_id,
        title: row.title,
        artist: row.artist,
        durationSeconds: row.duration_seconds,
        coverUrl: row.cover_url,
        addedBy: row.added_by,
        addedAt: row.added_at,
      })),
  };
}

export async function countEntries(db: Queryable, playlistId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    "SELECT count(*) FROM playlist_entries WHERE playlist_id = $1",
    [playlistId],
  );
  return Number(rows[0]!.count);
}

/** The place of an entry OF THIS PLAYLIST (an id from another playlist is simply not found). */
export async function findEntryPosition(
  db: Queryable,
  playlistId: string,
  entryId: string,
): Promise<number | null> {
  const { rows } = await db.query<{ position: number }>(
    "SELECT position FROM playlist_entries WHERE playlist_id = $1 AND id = $2",
    [playlistId, entryId],
  );
  return rows[0] ? rows[0].position : null;
}

export interface NewEntry {
  playlistId: string;
  addedBy: string;
  providerTrackId: string;
  title: string;
  artist: string;
  durationSeconds: number;
  coverUrl: string | null;
}

/**
 * Puts a new entry at `position` (0 to n): everything from there on moves one place down.
 * The caller has checked that the playlist is not full.
 */
export async function insertEntryAt(
  db: Queryable,
  entry: NewEntry,
  position: number,
): Promise<void> {
  await db.query(
    "UPDATE playlist_entries SET position = position + 1 WHERE playlist_id = $1 AND position >= $2",
    [entry.playlistId, position],
  );
  await db.query(
    `INSERT INTO playlist_entries (playlist_id, position, provider_track_id, title, artist,
                                   duration_seconds, cover_url, added_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.playlistId,
      position,
      entry.providerTrackId,
      entry.title,
      entry.artist,
      entry.durationSeconds,
      entry.coverUrl,
      entry.addedBy,
    ],
  );
}

/**
 * Moves the entry that is at place `from` to place `to`; the entries in between move one
 * place towards the gap it leaves. Both places are positions in the CURRENT list.
 */
export async function moveEntry(
  db: Queryable,
  playlistId: string,
  entryId: string,
  from: number,
  to: number,
): Promise<void> {
  if (to < from) {
    // Moving up: the entries from `to` up to just before `from` each go one place down.
    await db.query(
      `UPDATE playlist_entries SET position = position + 1
       WHERE playlist_id = $1 AND position >= $2 AND position < $3`,
      [playlistId, to, from],
    );
  } else {
    // Moving down: the entries just after `from` up to `to` each go one place up.
    await db.query(
      `UPDATE playlist_entries SET position = position - 1
       WHERE playlist_id = $1 AND position > $2 AND position <= $3`,
      [playlistId, from, to],
    );
  }
  await db.query(
    "UPDATE playlist_entries SET position = $3 WHERE playlist_id = $1 AND id = $2",
    [playlistId, entryId, to],
  );
}

/** Removes the entry at `position`; everything after it moves one place up. */
export async function removeEntryAt(
  db: Queryable,
  playlistId: string,
  entryId: string,
  position: number,
): Promise<void> {
  await db.query("DELETE FROM playlist_entries WHERE playlist_id = $1 AND id = $2", [
    playlistId,
    entryId,
  ]);
  await db.query(
    "UPDATE playlist_entries SET position = position - 1 WHERE playlist_id = $1 AND position > $2",
    [playlistId, position],
  );
}

/** Every edit that really changes the list raises the version (ADR-009). */
export async function bumpPlaylistVersion(
  db: Queryable,
  playlistId: string,
): Promise<void> {
  await db.query("UPDATE playlists SET version = version + 1 WHERE id = $1", [
    playlistId,
  ]);
}
