-- Up Migration

-- Playlist Editor: the entries of a playlist, in order (ADR-009, ADR-020).

-- Grows with every edit that really changes the list. Clients ignore a snapshot that is
-- not newer than the one they hold.
ALTER TABLE playlists
  ADD COLUMN version bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT playlists_version_not_negative CHECK (version >= 0);

CREATE TABLE playlist_entries (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- If the playlist is deleted, its entries go with it.
  playlist_id       uuid        NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  -- The place in the list: exactly 0, 1, 2, ... n-1 with no gap (the app keeps it so).
  -- The range IS the size limit: positions are unique, so at most 500 entries fit.
  position          integer     NOT NULL,
  -- The catalog's id (Deezer). The fields below are a COPY taken when the track was added,
  -- so the playlist keeps working if the catalog is down or changes (ADR-015).
  provider_track_id text        NOT NULL,
  title             text        NOT NULL,
  artist            text        NOT NULL,
  duration_seconds  integer     NOT NULL,
  cover_url         text,
  -- Deleting a user is not a supported feature; if it is ever added, their entries go too.
  added_by          uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  added_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT playlist_entries_position_range     CHECK (position BETWEEN 0 AND 499),
  CONSTRAINT playlist_entries_provider_id_len    CHECK (char_length(provider_track_id) BETWEEN 1 AND 64),
  CONSTRAINT playlist_entries_title_len          CHECK (char_length(title) BETWEEN 1 AND 500),
  CONSTRAINT playlist_entries_artist_len         CHECK (char_length(artist) BETWEEN 1 AND 500),
  CONSTRAINT playlist_entries_duration_range     CHECK (duration_seconds BETWEEN 0 AND 86400),
  CONSTRAINT playlist_entries_cover_url_len      CHECK (char_length(cover_url) <= 2048),

  -- Two entries can never share a place. DEFERRABLE INITIALLY DEFERRED: it is checked when
  -- the transaction COMMITS, so one `UPDATE ... SET position = position + 1` can shift a
  -- block of rows (for a moment two rows would share a place) and the database still
  -- refuses to commit any state in which they do.
  CONSTRAINT playlist_entries_position_key UNIQUE (playlist_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX playlist_entries_added_by_idx ON playlist_entries (added_by);

-- Down Migration

DROP TABLE playlist_entries;
ALTER TABLE playlists
  DROP CONSTRAINT playlists_version_not_negative,
  DROP COLUMN version;
