import type pg from "pg";

// All SQL for the queue of an event: its tracks, their votes and the queue version.
// Functions take `db` so the caller decides whether they run on the pool or inside a
// transaction. Everything that CHANGES the queue is called from one transaction that
// first locked the event row (see findEvent in repository.ts).
type Queryable = Pick<pg.Pool, "query">;

export type TrackStatus = "queued" | "playing" | "played";

export interface TrackRecord {
  id: string;
  eventId: string;
  providerTrackId: string;
  title: string;
  artist: string;
  durationSeconds: number;
  coverUrl: string | null;
  suggestedBy: string;
  status: TrackStatus;
  voteCount: number;
  suggestedAt: Date;
  /** Whether the user the query was run for has voted for it. */
  votedByMe: boolean;
}

interface TrackRow {
  id: string;
  event_id: string;
  provider_track_id: string;
  title: string;
  artist: string;
  duration_seconds: number;
  cover_url: string | null;
  suggested_by: string;
  status: TrackStatus;
  vote_count: number;
  suggested_at: Date;
  voted_by_me: boolean;
}

// $1 is always the user the query is run for.
const TRACK_SELECT = `
  t.id, t.event_id, t.provider_track_id, t.title, t.artist, t.duration_seconds, t.cover_url,
  t.suggested_by, t.status, t.vote_count, t.suggested_at,
  EXISTS (SELECT 1 FROM event_track_votes v WHERE v.track_id = t.id AND v.user_id = $1) AS voted_by_me`;

function toTrack(row: TrackRow): TrackRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    providerTrackId: row.provider_track_id,
    title: row.title,
    artist: row.artist,
    durationSeconds: row.duration_seconds,
    coverUrl: row.cover_url,
    suggestedBy: row.suggested_by,
    status: row.status,
    voteCount: row.vote_count,
    suggestedAt: row.suggested_at,
    votedByMe: row.voted_by_me,
  };
}

/**
 * The queue as shown to the app: the `playing` track first, then the `queued` ones
 * ranked (most votes, oldest suggestion on ties, id last). `played` tracks are history.
 * The version comes from the SAME statement as the tracks, so both describe one moment:
 * a version that ran ahead of its data would make clients ignore the next real update.
 * Returns null if the event does not exist.
 */
export async function readQueue(
  db: Queryable,
  eventId: string,
  userId: string,
): Promise<{ version: number; tracks: TrackRecord[] } | null> {
  const { rows } = await db.query<TrackRow & { queue_version: string }>(
    `SELECT e.queue_version, ${TRACK_SELECT}
     FROM events e
     LEFT JOIN event_tracks t ON t.event_id = e.id AND t.status IN ('playing', 'queued')
     WHERE e.id = $2
     ORDER BY (t.status = 'playing') DESC NULLS LAST, t.vote_count DESC, t.suggested_at, t.id`,
    [userId, eventId],
  );
  const first = rows[0];
  if (!first) return null;
  return {
    version: Number(first.queue_version), // bigint arrives as a string
    // An event with no tracks yields one row whose track columns are all NULL.
    tracks: rows.filter((row) => row.id !== null).map(toTrack),
  };
}

/** One track of THIS event (a track id of another event is simply not found). */
export async function findTrack(
  db: Queryable,
  eventId: string,
  trackId: string,
  userId: string,
): Promise<TrackRecord | null> {
  const { rows } = await db.query<TrackRow>(
    `SELECT ${TRACK_SELECT} FROM event_tracks t WHERE t.id = $2 AND t.event_id = $3`,
    [userId, trackId, eventId],
  );
  return rows[0] ? toTrack(rows[0]) : null;
}

/** The queued copy of a catalog track in an event, if any (the one a duplicate collides with). */
export async function findQueuedByProviderTrack(
  db: Queryable,
  eventId: string,
  providerTrackId: string,
  userId: string,
): Promise<TrackRecord | null> {
  const { rows } = await db.query<TrackRow>(
    `SELECT ${TRACK_SELECT} FROM event_tracks t
     WHERE t.event_id = $2 AND t.provider_track_id = $3 AND t.status = 'queued'`,
    [userId, eventId, providerTrackId],
  );
  return rows[0] ? toTrack(rows[0]) : null;
}

export interface NewTrack {
  eventId: string;
  suggestedBy: string;
  providerTrackId: string;
  title: string;
  artist: string;
  durationSeconds: number;
  coverUrl: string | null;
}

/**
 * Adds a track to the queue with its first vote: the suggester's own (vote_count 1 and
 * the matching row in event_track_votes, in the caller's transaction).
 * @throws a unique violation when the same song is already queued in this event.
 */
export async function insertSuggestedTrack(
  db: Queryable,
  track: NewTrack,
): Promise<TrackRecord> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO event_tracks (event_id, provider_track_id, title, artist, duration_seconds,
                               cover_url, suggested_by, vote_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1) RETURNING id`,
    [
      track.eventId,
      track.providerTrackId,
      track.title,
      track.artist,
      track.durationSeconds,
      track.coverUrl,
      track.suggestedBy,
    ],
  );
  const id = rows[0]!.id;
  await db.query("INSERT INTO event_track_votes (track_id, user_id) VALUES ($1, $2)", [
    id,
    track.suggestedBy,
  ]);
  return (await findTrack(db, track.eventId, id, track.suggestedBy))!;
}

/** Records a vote. Returns false if this user had already voted (nothing changed). */
export async function insertVote(
  db: Queryable,
  trackId: string,
  userId: string,
): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO event_track_votes (track_id, user_id) VALUES ($1, $2)
     ON CONFLICT (track_id, user_id) DO NOTHING`,
    [trackId, userId],
  );
  return result.rowCount === 1;
}

/** Removes a vote. Returns false if this user had not voted (nothing changed). */
export async function deleteVote(
  db: Queryable,
  trackId: string,
  userId: string,
): Promise<boolean> {
  const result = await db.query(
    "DELETE FROM event_track_votes WHERE track_id = $1 AND user_id = $2",
    [trackId, userId],
  );
  return result.rowCount === 1;
}

/**
 * Changes the counter by +1 or -1 with ONE atomic statement (never "read, add, write
 * back"), and only after a vote row really was added or removed (ADR-008).
 */
export async function adjustVoteCount(
  db: Queryable,
  trackId: string,
  delta: 1 | -1,
): Promise<number> {
  const { rows } = await db.query<{ vote_count: number }>(
    "UPDATE event_tracks SET vote_count = vote_count + $2 WHERE id = $1 RETURNING vote_count",
    [trackId, delta],
  );
  return rows[0]!.vote_count;
}

/** Every change to the queue increases the version (ADR-016). */
export async function bumpQueueVersion(db: Queryable, eventId: string): Promise<void> {
  await db.query("UPDATE events SET queue_version = queue_version + 1 WHERE id = $1", [
    eventId,
  ]);
}

/** The track that is playing now, if any (an event has at most one). */
export async function findPlayingTrack(
  db: Queryable,
  eventId: string,
  userId: string,
): Promise<TrackRecord | null> {
  const { rows } = await db.query<TrackRow>(
    `SELECT ${TRACK_SELECT} FROM event_tracks t WHERE t.event_id = $2 AND t.status = 'playing'`,
    [userId, eventId],
  );
  return rows[0] ? toTrack(rows[0]) : null;
}

// started_at / ended_at use clock_timestamp(), NOT now(): now() is the moment the
// TRANSACTION began, and a request that began waiting for the event's lock early can run
// after one that began later. It would then stamp an end earlier than the start that
// the other request just wrote, and the lifecycle constraint would reject it.
export async function finishTrack(db: Queryable, trackId: string): Promise<void> {
  await db.query(
    "UPDATE event_tracks SET status = 'played', ended_at = clock_timestamp() WHERE id = $1",
    [trackId],
  );
}

/**
 * Starts the best queued track: most votes, then oldest suggestion, then id (the same
 * order as the queue). Returns false if nothing is queued. The caller holds the event's
 * lock and has already finished the previous track, so the one-playing-track index holds.
 */
export async function startBestQueuedTrack(
  db: Queryable,
  eventId: string,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE event_tracks SET status = 'playing', started_at = clock_timestamp()
     WHERE id = (SELECT id FROM event_tracks WHERE event_id = $1 AND status = 'queued'
                 ORDER BY vote_count DESC, suggested_at, id LIMIT 1)`,
    [eventId],
  );
  return result.rowCount === 1;
}
