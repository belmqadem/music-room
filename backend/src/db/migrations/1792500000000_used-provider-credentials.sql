-- Up Migration

-- One-time use of Google and Facebook credentials (ADR-047). A credential the server accepted
-- (to log in, to link, or as the proof for linking or unlinking) is remembered by its SHA-256
-- until it expires at the provider; a second use is refused. Without this, a captured, still
-- valid credential could be replayed: a Google ID token for up to its age limit, a Facebook
-- classic access token for weeks. Only verified credentials get a row, so garbage sent by
-- anyone cannot fill the table; expired rows are removed as new ones arrive.
CREATE TABLE used_provider_credentials (
  -- hex SHA-256 of "provider:credential": the credential itself is never stored.
  credential_hash text        PRIMARY KEY,
  expires_at      timestamptz NOT NULL
);
CREATE INDEX used_provider_credentials_expires_idx ON used_provider_credentials (expires_at);

-- Down Migration

DROP TABLE used_provider_credentials;
