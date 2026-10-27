-- Up Migration

-- "Rooms near me" (ADR-052) reads only public "At the venue" rooms whose window has not ended.
-- A partial index holds just those rows, by end of window, so the query never scans the
-- other rooms however many there are.
CREATE INDEX events_nearby_idx ON events (ends_at)
  WHERE visibility = 'public' AND vote_license = 'location_time';

-- Down Migration

DROP INDEX events_nearby_idx;
