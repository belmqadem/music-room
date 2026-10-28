-- Up Migration

-- User search by display name (GET /users?query=): a case-insensitive PREFIX
-- match, `lower(display_name) LIKE 'ada%'`. text_pattern_ops lets Postgres use
-- this index for LIKE prefixes whatever the database collation is.
CREATE INDEX users_display_name_search_idx ON users (lower(display_name) text_pattern_ops);

-- Down Migration

DROP INDEX users_display_name_search_idx;
