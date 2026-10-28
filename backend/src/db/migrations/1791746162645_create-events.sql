-- Up Migration

-- Track Vote events (ADR-005, ADR-013). The access rules live in the app (the
-- shared access engine); this table makes invalid licenses impossible to store.
CREATE TABLE events (
  id             uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  -- If the owner is deleted, their events go with them.
  owner_id       uuid             NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name           text             NOT NULL,
  -- text + CHECK instead of ENUMs: adding a value later is a simple constraint change.
  visibility     text             NOT NULL DEFAULT 'public',
  vote_license   text             NOT NULL DEFAULT 'everyone',
  -- The location + time rule. Filled in if and only if vote_license = 'location_time'.
  latitude       double precision,
  longitude      double precision,
  radius_meters  integer,
  starts_at      timestamptz,
  ends_at        timestamptz,
  created_at     timestamptz      NOT NULL DEFAULT now(),

  CONSTRAINT events_name_len        CHECK (char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT events_visibility_known CHECK (visibility IN ('public', 'private')),
  CONSTRAINT events_vote_license_known CHECK (vote_license IN ('everyone', 'invited_only', 'location_time')),
  -- NULL passes a CHECK, so these only restrict values that are present.
  CONSTRAINT events_latitude_range  CHECK (latitude  BETWEEN -90  AND 90),
  CONSTRAINT events_longitude_range CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT events_radius_range    CHECK (radius_meters BETWEEN 1 AND 100000),
  CONSTRAINT events_window_order    CHECK (starts_at < ends_at),
  -- All five location fields together for location_time, none of them otherwise.
  CONSTRAINT events_location_time_complete CHECK (
    (vote_license = 'location_time'
      AND latitude IS NOT NULL AND longitude IS NOT NULL AND radius_meters IS NOT NULL
      AND starts_at IS NOT NULL AND ends_at IS NOT NULL)
    OR
    (vote_license <> 'location_time'
      AND latitude IS NULL AND longitude IS NULL AND radius_meters IS NULL
      AND starts_at IS NULL AND ends_at IS NULL)
  )
);

-- "Events of this owner", and the newest-first listing (keyset pagination on created_at, id).
CREATE INDEX events_owner_id_idx ON events (owner_id);
CREATE INDEX events_listing_idx ON events (created_at DESC, id DESC);

-- Who is invited to an event. The primary key is also the "already invited"
-- rule: inviting twice is a unique violation (ALREADY_INVITED).
CREATE TABLE event_invitations (
  event_id   uuid        NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id)  ON DELETE CASCADE,
  invited_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (event_id, user_id)
);

-- "Events I am invited to" (the primary key covers lookups by event first).
CREATE INDEX event_invitations_user_id_idx ON event_invitations (user_id);

-- Down Migration

DROP TABLE event_invitations;
DROP TABLE events;
