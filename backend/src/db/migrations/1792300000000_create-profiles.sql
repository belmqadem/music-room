-- Up Migration

-- Profiles (ADR-024): the optional personal details of a user, in fixed blocks. WHO sees each
-- block is decided by the server (see modules/profiles/visibility.ts), not stored per user:
--   public       bio                      any signed-in user
--   friends      full_name, city, genres  accepted friends and the owner
--   private      phone, birth_date        the owner only
-- A row is created on the first PATCH; a user without a row simply has an empty profile.
CREATE TABLE profiles (
  user_id     uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  bio         text,
  full_name   text,
  city        text,
  phone       text,
  birth_date  date,
  genres      text[]      NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT profiles_bio_length CHECK (char_length(bio) <= 280),
  CONSTRAINT profiles_full_name_length CHECK (char_length(full_name) <= 80),
  CONSTRAINT profiles_city_length CHECK (char_length(city) <= 80),
  CONSTRAINT profiles_phone_length CHECK (char_length(phone) <= 30),
  CONSTRAINT profiles_genres_count CHECK (cardinality(genres) <= 10)
);

-- Down Migration

DROP TABLE profiles;
