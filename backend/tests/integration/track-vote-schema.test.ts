import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Integration tests for the Track Vote tables: event_tracks, event_track_votes and
// events.queue_version. They need a migrated database: set TEST_DATABASE_URL (see
// `make test-integration`), otherwise the whole file is skipped. Each test runs inside
// a transaction that is rolled back, so no data is left behind. Because a failed
// statement aborts a Postgres transaction, a test that expects an error has exactly
// one failing statement, and it is the last one.
const databaseUrl = process.env.TEST_DATABASE_URL;

const PG_UNIQUE_VIOLATION = "23505";
const PG_CHECK_VIOLATION = "23514";
const PG_FOREIGN_KEY_VIOLATION = "23503";
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

type Row = Record<string, unknown>;

describe.skipIf(!databaseUrl)("track vote schema constraints", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function insertUser(): Promise<string> {
    const { rows } = await client.query(
      "INSERT INTO users (display_name) VALUES ('U') RETURNING id",
    );
    return rows[0].id;
  }
  async function insertEvent(ownerId: string): Promise<string> {
    const { rows } = await client.query(
      "INSERT INTO events (owner_id, name) VALUES ($1, 'E') RETURNING id",
      [ownerId],
    );
    return rows[0].id;
  }
  async function insertTrack(
    eventId: string,
    userId: string,
    extra: Row = {},
  ): Promise<Row> {
    const values: Row = {
      event_id: eventId,
      suggested_by: userId,
      provider_track_id: "3135556",
      title: "Harder, Better, Faster, Stronger",
      artist: "Daft Punk",
      duration_seconds: 226,
      ...extra,
    };
    const columns = Object.keys(values);
    const { rows } = await client.query<Row>(
      `INSERT INTO event_tracks (${columns.join(", ")})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
      Object.values(values),
    );
    return rows[0]!;
  }
  const playingFields = { status: "playing", started_at: "2026-10-12T20:00:00Z" };
  const playedFields = {
    status: "played",
    started_at: "2026-10-12T20:00:00Z",
    ended_at: "2026-10-12T20:04:00Z",
  };

  async function expectPgError(statement: Promise<unknown>, code: string): Promise<void> {
    await expect(statement).rejects.toMatchObject({ code });
  }

  async function setup() {
    const owner = await insertUser();
    const eventId = await insertEvent(owner);
    return { owner, eventId };
  }

  describe("events.queue_version", () => {
    it("starts at 0 and cannot go negative", async () => {
      const { eventId } = await setup();
      const { rows } = await client.query(
        "SELECT queue_version FROM events WHERE id = $1",
        [eventId],
      );

      expect(Number(rows[0].queue_version)).toBe(0);
      await expectPgError(
        client.query("UPDATE events SET queue_version = -1 WHERE id = $1", [eventId]),
        PG_CHECK_VIOLATION,
      );
    });
  });

  describe("event_tracks", () => {
    it("starts queued with no votes and no timestamps", async () => {
      const { owner, eventId } = await setup();

      const track = await insertTrack(eventId, owner);

      expect(track).toMatchObject({
        status: "queued",
        vote_count: 0,
        started_at: null,
        ended_at: null,
        cover_url: null,
      });
      expect(track["suggested_at"]).toBeInstanceOf(Date);
    });

    it.each([
      ["an unknown status", { status: "paused" }],
      ["a negative vote count", { vote_count: -1 }],
      ["an empty provider track id", { provider_track_id: "" }],
      ["a provider track id over 64 characters", { provider_track_id: "x".repeat(65) }],
      ["an empty title", { title: "" }],
      ["a title over 500 characters", { title: "x".repeat(501) }],
      ["an empty artist", { artist: "" }],
      ["an artist over 500 characters", { artist: "x".repeat(501) }],
      ["a negative duration", { duration_seconds: -1 }],
      ["a duration over a day", { duration_seconds: 86401 }],
      ["a cover url over 2048 characters", { cover_url: "x".repeat(2049) }],
    ])("rejects %s", async (_label, override) => {
      const { owner, eventId } = await setup();

      await expectPgError(insertTrack(eventId, owner, override), PG_CHECK_VIOLATION);
    });

    it("accepts the boundary values", async () => {
      const { owner, eventId } = await setup();

      await expect(
        insertTrack(eventId, owner, {
          provider_track_id: "x".repeat(64),
          title: "x".repeat(500),
          artist: "x".repeat(500),
          duration_seconds: 0,
          cover_url: "x".repeat(2048),
        }),
      ).resolves.toBeDefined();
    });

    it.each([
      [
        "a queued track that already has a start time",
        { started_at: "2026-10-12T20:00:00Z" },
      ],
      [
        "a queued track that already has an end time",
        { ended_at: "2026-10-12T20:00:00Z" },
      ],
      ["a playing track without a start time", { status: "playing" }],
      [
        "a playing track that already ended",
        { ...playingFields, ended_at: "2026-10-12T20:05:00Z" },
      ],
      [
        "a played track without an end time",
        { status: "played", started_at: "2026-10-12T20:00:00Z" },
      ],
      [
        "a played track without a start time",
        { status: "played", ended_at: "2026-10-12T20:00:00Z" },
      ],
      [
        "a track that ended before it started",
        { ...playedFields, ended_at: "2026-10-12T19:00:00Z" },
      ],
    ])("rejects %s", async (_label, override) => {
      const { owner, eventId } = await setup();

      await expectPgError(insertTrack(eventId, owner, override), PG_CHECK_VIOLATION);
    });

    it("accepts a coherent playing track and a coherent played track", async () => {
      const { owner, eventId } = await setup();

      await expect(insertTrack(eventId, owner, playingFields)).resolves.toBeDefined();
      await expect(
        insertTrack(eventId, owner, { ...playedFields, provider_track_id: "2" }),
      ).resolves.toBeDefined();
    });

    it("rejects an event that does not exist", async () => {
      const { owner } = await setup();

      await expectPgError(insertTrack(MISSING_UUID, owner), PG_FOREIGN_KEY_VIOLATION);
    });

    it("rejects a suggester that does not exist", async () => {
      const { eventId } = await setup();

      await expectPgError(insertTrack(eventId, MISSING_UUID), PG_FOREIGN_KEY_VIOLATION);
    });

    describe("the same song twice (TRACK_ALREADY_QUEUED)", () => {
      it("cannot be queued twice in one event", async () => {
        const { owner, eventId } = await setup();
        await insertTrack(eventId, owner);

        await expectPgError(insertTrack(eventId, owner), PG_UNIQUE_VIOLATION);
      });

      it("can be queued in two different events", async () => {
        const { owner, eventId } = await setup();
        const otherEvent = await insertEvent(owner);
        await insertTrack(eventId, owner);

        await expect(insertTrack(otherEvent, owner)).resolves.toBeDefined();
      });

      it("can be queued again once it is playing or has been played", async () => {
        const { owner, eventId } = await setup();
        await insertTrack(eventId, owner, playingFields);
        await insertTrack(eventId, owner, {
          ...playedFields,
          provider_track_id: "3135556",
        });

        await expect(insertTrack(eventId, owner)).resolves.toMatchObject({
          status: "queued",
        });
      });

      it("lets several different songs be queued", async () => {
        const { owner, eventId } = await setup();
        await insertTrack(eventId, owner, { provider_track_id: "1" });

        await expect(
          insertTrack(eventId, owner, { provider_track_id: "2" }),
        ).resolves.toBeDefined();
      });
    });

    describe("one playing track per event", () => {
      it("refuses a second playing track in the same event", async () => {
        const { owner, eventId } = await setup();
        await insertTrack(eventId, owner, { ...playingFields, provider_track_id: "1" });

        await expectPgError(
          insertTrack(eventId, owner, { ...playingFields, provider_track_id: "2" }),
          PG_UNIQUE_VIOLATION,
        );
      });

      it("allows one playing track per event, and played tracks beside it", async () => {
        const { owner, eventId } = await setup();
        const otherEvent = await insertEvent(owner);
        await insertTrack(eventId, owner, { ...playingFields, provider_track_id: "1" });
        await insertTrack(eventId, owner, { ...playedFields, provider_track_id: "2" });
        await insertTrack(eventId, owner, { ...playedFields, provider_track_id: "3" });

        await expect(
          insertTrack(otherEvent, owner, { ...playingFields, provider_track_id: "1" }),
        ).resolves.toBeDefined();
      });

      it("refuses to promote a second track to playing", async () => {
        const { owner, eventId } = await setup();
        await insertTrack(eventId, owner, { ...playingFields, provider_track_id: "1" });
        const queued = await insertTrack(eventId, owner, { provider_track_id: "2" });

        await expectPgError(
          client.query(
            "UPDATE event_tracks SET status = 'playing', started_at = now() WHERE id = $1",
            [queued["id"]],
          ),
          PG_UNIQUE_VIOLATION,
        );
      });
    });

    it("is deleted with its event", async () => {
      const { owner, eventId } = await setup();
      await insertTrack(eventId, owner);

      await client.query("DELETE FROM events WHERE id = $1", [eventId]);

      const { rows } = await client.query(
        "SELECT count(*) FROM event_tracks WHERE event_id = $1",
        [eventId],
      );
      expect(Number(rows[0].count)).toBe(0);
    });

    it("serves the ranking from its partial index", async () => {
      const { owner, eventId } = await setup();
      await insertTrack(eventId, owner);
      // The planner may pick another index (and sort) when the table is tiny or its statistics
      // change, so forbid sorting: the only way left to read the rows in ranking order is the ranking index.
      await client.query("SET LOCAL enable_seqscan = off");
      await client.query("SET LOCAL enable_sort = off");

      const plan = await client.query<{ "QUERY PLAN": string }>(
        `EXPLAIN SELECT id FROM event_tracks WHERE event_id = $1 AND status = 'queued'
         ORDER BY vote_count DESC, suggested_at, id`,
        [eventId],
      );

      expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
        "event_tracks_ranking_idx",
      );
    });
  });

  describe("event_track_votes", () => {
    async function trackAndVoter() {
      const { owner, eventId } = await setup();
      const track = await insertTrack(eventId, owner);
      const voter = await insertUser();
      return { owner, eventId, trackId: track["id"] as string, voter };
    }

    it("records one vote per user and track", async () => {
      const { trackId, voter } = await trackAndVoter();

      await client.query(
        "INSERT INTO event_track_votes (track_id, user_id) VALUES ($1, $2)",
        [trackId, voter],
      );

      const { rows } = await client.query(
        "SELECT * FROM event_track_votes WHERE track_id = $1",
        [trackId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].created_at).toBeInstanceOf(Date);
    });

    it("refuses the same user voting twice for one track", async () => {
      const { trackId, voter } = await trackAndVoter();
      await client.query(
        "INSERT INTO event_track_votes (track_id, user_id) VALUES ($1, $2)",
        [trackId, voter],
      );

      await expectPgError(
        client.query(
          "INSERT INTO event_track_votes (track_id, user_id) VALUES ($1, $2)",
          [trackId, voter],
        ),
        PG_UNIQUE_VIOLATION,
      );
    });

    it("lets one user vote for several tracks and several users vote for one track", async () => {
      const { owner, eventId, trackId, voter } = await trackAndVoter();
      const other = await insertTrack(eventId, owner, { provider_track_id: "2" });
      const second = await insertUser();
      await client.query(
        "INSERT INTO event_track_votes (track_id, user_id) VALUES ($1, $2)",
        [trackId, voter],
      );
      await client.query(
        "INSERT INTO event_track_votes (track_id, user_id) VALUES ($1, $2)",
        [other["id"], voter],
      );

      await client.query(
        "INSERT INTO event_track_votes (track_id, user_id) VALUES ($1, $2)",
        [trackId, second],
      );

      // Only the rows of THIS test: other test files run in parallel and commit votes of their own.
      const { rows } = await client.query(
        "SELECT count(*) FROM event_track_votes WHERE track_id = ANY($1)",
        [[trackId, other["id"]]],
      );
      expect(Number(rows[0].count)).toBe(3);
    });

    it("rejects a track or a user that does not exist", async () => {
      const { voter } = await trackAndVoter();

      await expectPgError(
        client.query(
          "INSERT INTO event_track_votes (track_id, user_id) VALUES ($1, $2)",
          [MISSING_UUID, voter],
        ),
        PG_FOREIGN_KEY_VIOLATION,
      );
    });

    it("rejects a user that does not exist", async () => {
      const { trackId } = await trackAndVoter();

      await expectPgError(
        client.query(
          "INSERT INTO event_track_votes (track_id, user_id) VALUES ($1, $2)",
          [trackId, MISSING_UUID],
        ),
        PG_FOREIGN_KEY_VIOLATION,
      );
    });

    it("is deleted with its track, and with its event", async () => {
      const { eventId, trackId, voter } = await trackAndVoter();
      await client.query(
        "INSERT INTO event_track_votes (track_id, user_id) VALUES ($1, $2)",
        [trackId, voter],
      );

      await client.query("DELETE FROM events WHERE id = $1", [eventId]);

      const { rows } = await client.query(
        "SELECT count(*) FROM event_track_votes WHERE track_id = $1",
        [trackId],
      );
      expect(Number(rows[0].count)).toBe(0);
    });

    it("disappears with the voter but leaves the track", async () => {
      const { trackId, voter } = await trackAndVoter();
      await client.query(
        "INSERT INTO event_track_votes (track_id, user_id) VALUES ($1, $2)",
        [trackId, voter],
      );

      await client.query("DELETE FROM users WHERE id = $1", [voter]);

      const votes = await client.query(
        "SELECT count(*) FROM event_track_votes WHERE track_id = $1",
        [trackId],
      );
      const tracks = await client.query(
        "SELECT count(*) FROM event_tracks WHERE id = $1",
        [trackId],
      );
      expect(Number(votes.rows[0].count)).toBe(0);
      expect(Number(tracks.rows[0].count)).toBe(1);
    });
  });
});
