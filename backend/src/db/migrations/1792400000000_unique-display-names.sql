-- Up Migration

-- Display names become unique handles that people find each other by (ADR-046). The rules
-- (3 to 20 characters: a-z, 0-9, "." and "_", starting with a letter) are checked by the API,
-- which also lowercases the name; this index makes two accounts with the same name impossible,
-- even when they are chosen at the same moment, and ignores letter case either way.
--
-- `display_name_set` is false until the user has chosen their name. Until then the account
-- holds a temporary name (`user_` and 12 hex digits), cannot be found by search, and every
-- signed-in endpoint except choosing the name answers 403 DISPLAY_NAME_REQUIRED.
ALTER TABLE users ADD COLUMN display_name_set boolean NOT NULL DEFAULT false;

-- Every existing account chooses at its next sign-in. Its old, free-text name is replaced by a
-- temporary one taken from its id, so no two collide (the old names may, and may break the rules).
UPDATE users SET display_name = 'user_' || substr(replace(id::text, '-', ''), 1, 12);

CREATE UNIQUE INDEX users_display_name_lower_key ON users (lower(display_name));

-- Down Migration

-- The old free-text names are not restored: they were replaced in the Up step.
DROP INDEX users_display_name_lower_key;
ALTER TABLE users DROP COLUMN display_name_set;
