-- Up Migration

-- Email ownership (ADR-022). NULL = the address was never proven. A password account cannot
-- log in until this is set; a social account gets it at once when the provider vouches for
-- the email (Google marks it verified), and a reset-by-code sets it too.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

-- Accounts that exist before this migration are trusted as they are, otherwise they would be
-- locked out by a rule they never saw.
UPDATE users SET email_verified_at = created_at WHERE email IS NOT NULL;

-- One pending code per user and purpose: asking for a new code replaces the old one, so there
-- is never more than one valid code to guess. The code itself is never stored, only a keyed hash.
CREATE TABLE email_codes (
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose     text        NOT NULL,
  -- Hex HMAC-SHA256 (64 chars) of the code. A 6-digit code has only a million values, so a
  -- plain hash could be reversed from a leaked database in a second; the key makes that useless.
  code_hash   text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  -- Every try counts, right or wrong; at the limit the code is dead and a new one is needed.
  attempts    integer     NOT NULL DEFAULT 0,
  -- When the code was issued: the "resend" cooldown is judged from this.
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT email_codes_pkey PRIMARY KEY (user_id, purpose),
  CONSTRAINT email_codes_purpose_valid CHECK (purpose IN ('verify_email', 'reset_password')),
  CONSTRAINT email_codes_hash_len CHECK (char_length(code_hash) = 64),
  CONSTRAINT email_codes_attempts_nonneg CHECK (attempts >= 0)
);

-- Down Migration

DROP TABLE email_codes;
ALTER TABLE users DROP COLUMN email_verified_at;
