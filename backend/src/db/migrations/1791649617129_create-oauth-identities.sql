-- Up Migration

-- Links a user to a social account (Google or Facebook). ADR-007.
CREATE TABLE oauth_identities (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- If the user is deleted, their links go with them.
  user_id          uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- text + CHECK instead of a Postgres ENUM: adding a provider later is a simple
  -- constraint change, whereas altering an ENUM is more awkward.
  provider         text        NOT NULL,
  -- The user's id AT the provider (Google "sub", Facebook user id). Not their email.
  provider_user_id text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT oauth_identities_provider_known CHECK (provider IN ('google', 'facebook')),
  -- One social account can belong to only one user (the PROVIDER_ACCOUNT_LINKED error).
  CONSTRAINT oauth_identities_provider_account_key UNIQUE (provider, provider_user_id),
  -- A user links at most one account per provider (so "unlink google" is unambiguous).
  -- This also gives us a fast lookup by user_id.
  CONSTRAINT oauth_identities_user_provider_key UNIQUE (user_id, provider)
);

-- Down Migration

DROP TABLE oauth_identities;
