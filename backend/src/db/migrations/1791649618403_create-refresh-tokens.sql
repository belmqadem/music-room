-- Up Migration

-- Refresh tokens with rotation and reuse detection. ADR-003 / ADR-006.
-- A "family" is one login session: every token created by refreshing starts
-- from the same family_id. Rotation: the presented token is marked used and a
-- new token in the same family is inserted. If an already-used token is
-- presented again (stolen token), the whole family is revoked.
CREATE TABLE refresh_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id   uuid        NOT NULL,
  -- Hex SHA-256 (64 chars) of the token. The raw token is never stored, so a
  -- database leak does not hand out working tokens.
  token_hash  text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  -- Set when the token was exchanged for a new one (rotation).
  used_at     timestamptz,
  -- Set when the token (or its family) was revoked (logout, reuse detected).
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT refresh_tokens_hash_len CHECK (char_length(token_hash) = 64),
  -- UNIQUE also creates the index used to look a token up by its hash.
  CONSTRAINT refresh_tokens_hash_key UNIQUE (token_hash)
);

-- Revoking a whole family and listing a user's sessions need these lookups.
CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_id_idx   ON refresh_tokens (user_id);

-- Down Migration

DROP TABLE refresh_tokens;
