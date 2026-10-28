-- Up Migration

-- Playlist Editor playlists (ADR-005, ADR-013). Same shape as events, without the
-- location rule: the edit license is only everyone or invited_only.
-- The `version` counter for concurrent edits (ADR-009) is added with the editor.
CREATE TABLE playlists (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         text        NOT NULL,
  visibility   text        NOT NULL DEFAULT 'public',
  edit_license text        NOT NULL DEFAULT 'everyone',
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT playlists_name_len          CHECK (char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT playlists_visibility_known  CHECK (visibility IN ('public', 'private')),
  CONSTRAINT playlists_edit_license_known CHECK (edit_license IN ('everyone', 'invited_only'))
);

CREATE INDEX playlists_owner_id_idx ON playlists (owner_id);
CREATE INDEX playlists_listing_idx ON playlists (created_at DESC, id DESC);

CREATE TABLE playlist_invitations (
  playlist_id uuid        NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users (id)     ON DELETE CASCADE,
  invited_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (playlist_id, user_id)
);

CREATE INDEX playlist_invitations_user_id_idx ON playlist_invitations (user_id);

-- Down Migration

DROP TABLE playlist_invitations;
DROP TABLE playlists;
