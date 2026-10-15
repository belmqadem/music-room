-- Up Migration

-- Friendships (ADR-023): a request that the other person accepts. One row per PAIR of users,
-- whichever of them asked first: the unique index below is on the unordered pair, so A->B and
-- B->A can never both exist, even when both requests arrive at the same moment.
-- Declining, cancelling and unfriending DELETE the row, so a row is either waiting or accepted.
CREATE TABLE friendships (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  addressee_id  uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'pending',
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- When the request was accepted; NULL while it is pending.
  responded_at  timestamptz,

  CONSTRAINT friendships_status_valid CHECK (status IN ('pending', 'accepted')),
  CONSTRAINT friendships_not_self CHECK (requester_id <> addressee_id),
  CONSTRAINT friendships_responded_matches_status
    CHECK ((status = 'accepted') = (responded_at IS NOT NULL))
);

CREATE UNIQUE INDEX friendships_pair_key
  ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));

-- "My requests" and "my friends" look a user up on either side.
CREATE INDEX friendships_requester_idx ON friendships (requester_id, status);
CREATE INDEX friendships_addressee_idx ON friendships (addressee_id, status);

-- Down Migration

DROP TABLE friendships;
