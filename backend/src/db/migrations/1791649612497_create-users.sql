-- Up Migration

-- One row per account. Email/password accounts have both columns set; accounts
-- created through Google/Facebook may have no password (and, for Facebook,
-- possibly no email). See ADR-006 / ADR-007.
CREATE TABLE users (
  -- Random UUIDs (built in since Postgres 13): not guessable, unlike 1, 2, 3...
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text,
  -- bcrypt hash (about 60 chars). NULL for social-only accounts. Never returned by the API.
  password_hash text,
  display_name  text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT users_email_not_blank   CHECK (email IS NULL OR (email <> '' AND char_length(email) <= 254)),
  CONSTRAINT users_display_name_len  CHECK (char_length(display_name) BETWEEN 1 AND 50),
  -- A password account must be reachable by email, otherwise nobody could log in to it.
  CONSTRAINT users_password_needs_email CHECK (password_hash IS NULL OR email IS NOT NULL)
);

-- Email is unique ignoring letter case ("Bob@x.com" and "bob@x.com" are one account).
-- Postgres lets many rows have NULL in a unique index, so social-only users
-- without an email do not collide. Queries MUST look up with lower(email) for
-- this index to be used.
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

-- Down Migration

DROP TABLE users;
