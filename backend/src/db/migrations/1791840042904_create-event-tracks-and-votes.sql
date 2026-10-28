-- Up Migration

-- Track Vote: the queue of an event and the votes on it (ADR-008, ADR-015, ADR-016).
-- The rules that matter for correctness are enforced HERE, by the database, so that
-- no bug in the app and no race between requests can break them.

-- Grows with every change to the queue (suggestion, vote, advance). Clients ignore
-- a snapshot that is not newer than the one they hold (ADR-016).
ALTER TABLE events
  ADD COLUMN queue_version bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT events_queue_version_not_negative CHECK (queue_version >= 0);

CREATE TABLE event_tracks (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- If the event is deleted, its queue goes with it.
  event_id          uuid        NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  -- The catalog's id (Deezer). Metadata below is a COPY taken when the track was suggested,
  -- so the queue keeps working if the catalog is down or changes (ADR-015).
  provider_track_id text        NOT NULL,
  title             text        NOT NULL,
  artist            text        NOT NULL,
  duration_seconds  integer     NOT NULL,
  cover_url         text,
  -- Deleting a user is not a supported feature. If it is ever added, it must also
  -- recount vote_count, because their votes disappear with them.
  suggested_by      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- queued: can be voted for. playing: at most one per event, frozen. played: history.
  status            text        NOT NULL DEFAULT 'queued',
  -- Number of rows in event_track_votes for this track. Kept by the app, in the same
  -- transaction as the vote, with an atomic `vote_count = vote_count + 1` (ADR-008).
  vote_count        integer     NOT NULL DEFAULT 0,
  suggested_at      timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  ended_at          timestamptz,

  CONSTRAINT event_tracks_status_known     CHECK (status IN ('queued', 'playing', 'played')),
  CONSTRAINT event_tracks_vote_count_range CHECK (vote_count >= 0),
  CONSTRAINT event_tracks_provider_id_len  CHECK (char_length(provider_track_id) BETWEEN 1 AND 64),
  CONSTRAINT event_tracks_title_len        CHECK (char_length(title) BETWEEN 1 AND 500),
  CONSTRAINT event_tracks_artist_len       CHECK (char_length(artist) BETWEEN 1 AND 500),
  CONSTRAINT event_tracks_duration_range   CHECK (duration_seconds BETWEEN 0 AND 86400),
  CONSTRAINT event_tracks_cover_url_len    CHECK (char_length(cover_url) <= 2048),
  -- The timestamps must tell the same story as the status.
  CONSTRAINT event_tracks_lifecycle CHECK (
    (status = 'queued'  AND started_at IS NULL     AND ended_at IS NULL)
    OR (status = 'playing' AND started_at IS NOT NULL AND ended_at IS NULL)
    OR (status = 'played'  AND started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at >= started_at)
  )
);

-- The same song cannot be queued twice at once. Two people suggesting it at the
-- same moment: one insert wins, the other gets a unique violation (TRACK_ALREADY_QUEUED).
-- Once it has started playing it may be suggested again.
CREATE UNIQUE INDEX event_tracks_one_queued_per_provider_track
  ON event_tracks (event_id, provider_track_id) WHERE status = 'queued';

-- At most one track is playing per event, whatever two simultaneous "advance" requests do.
CREATE UNIQUE INDEX event_tracks_one_playing_per_event
  ON event_tracks (event_id) WHERE status = 'playing';

-- The ranking, exactly as it is sorted: most votes first, oldest suggestion on ties, id last.
CREATE INDEX event_tracks_ranking_idx
  ON event_tracks (event_id, vote_count DESC, suggested_at, id) WHERE status = 'queued';

CREATE INDEX event_tracks_suggested_by_idx ON event_tracks (suggested_by);

-- One row per (track, user): voting twice is a no-op, which is what makes PUT idempotent.
CREATE TABLE event_track_votes (
  track_id   uuid        NOT NULL REFERENCES event_tracks (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id)        ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (track_id, user_id)
);

-- "Which of these tracks did I vote for?" is answered by the primary key; this one
-- serves the foreign key when a user is removed.
CREATE INDEX event_track_votes_user_id_idx ON event_track_votes (user_id);

-- Down Migration

DROP TABLE event_track_votes;
DROP TABLE event_tracks;
ALTER TABLE events
  DROP CONSTRAINT events_queue_version_not_negative,
  DROP COLUMN queue_version;
