-- Up Migration

-- Free and Premium (ADR-048, the subject's bonus). Premium unlocks the Playlist Editor (creating
-- and editing playlists) and "At the venue" rooms. Payment is simulated: a user switches with
-- PUT /users/me/plan. Everyone starts on Free.
ALTER TABLE users
  ADD COLUMN plan text NOT NULL DEFAULT 'free',
  ADD COLUMN plan_changed_at timestamptz,
  ADD CONSTRAINT users_plan_valid CHECK (plan IN ('free', 'premium'));

-- Every switch, with where it came from: the record a real billing system would keep, and the
-- log line the subject asks for every mobile-triggered action.
CREATE TABLE plan_changes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  from_plan    text        NOT NULL,
  to_plan      text        NOT NULL,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  platform     text        NOT NULL,
  device       text        NOT NULL,
  app_version  text        NOT NULL,
  CONSTRAINT plan_changes_plans_valid CHECK (
    from_plan IN ('free', 'premium') AND to_plan IN ('free', 'premium') AND from_plan <> to_plan
  )
);
CREATE INDEX plan_changes_user_idx ON plan_changes (user_id, changed_at);

-- Down Migration

DROP TABLE plan_changes;
ALTER TABLE users DROP CONSTRAINT users_plan_valid, DROP COLUMN plan_changed_at, DROP COLUMN plan;
