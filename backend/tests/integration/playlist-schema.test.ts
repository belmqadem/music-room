import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Integration tests for playlist_entries and playlists.version. They need a migrated
// database: set TEST_DATABASE_URL (see `make test-integration`), otherwise the whole file
// is skipped. Most tests run inside a transaction that is rolled back, so no data is left
// behind. A failed statement aborts a Postgres transaction, so a test that expects an
// error has exactly one failing statement, and it is the last one.
const databaseUrl = process.env.TEST_DATABASE_URL;

const PG_UNIQUE_VIOLATION = "23505";
const PG_CHECK_VIOLATION = "23514";
const PG_FOREIGN_KEY_VIOLATION = "23503";
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

type Row = Record<string, unknown>;

describe.skipIf(!databaseUrl)("playlist schema constraints", () => {
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
  async function insertPlaylist(ownerId: string): Promise<string> {
    const { rows } = await client.query(
      "INSERT INTO playlists (owner_id, name) VALUES ($1, 'P') RETURNING id",
      [ownerId],
    );
    return rows[0].id;
  }
  async function insertEntry(
    playlistId: string,
    userId: string,
    extra: Row = {},
  ): Promise<Row> {
    const values: Row = {
      playlist_id: playlistId,
      added_by: userId,
      position: 0,
      provider_track_id: "3135556",
      title: "Harder, Better, Faster, Stronger",
      artist: "Daft Punk",
      duration_seconds: 226,
      ...extra,
    };
    const columns = Object.keys(values);
    const { rows } = await client.query<Row>(
      `INSERT INTO playlist_entries (${columns.join(", ")})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
      Object.values(values),
    );
    return rows[0]!;
  }
  async function setup() {
    const owner = await insertUser();
    const playlistId = await insertPlaylist(owner);
    return { owner, playlistId };
  }
  async function expectPgError(statement: Promise<unknown>, code: string): Promise<void> {
    await expect(statement).rejects.toMatchObject({ code });
  }

  describe("playlists.version", () => {
    it("starts at 0 and cannot go negative", async () => {
      const { playlistId } = await setup();

      const { rows } = await client.query("SELECT version FROM playlists WHERE id = $1", [
        playlistId,
      ]);

      expect(Number(rows[0].version)).toBe(0);
      await expectPgError(
        client.query("UPDATE playlists SET version = -1 WHERE id = $1", [playlistId]),
        PG_CHECK_VIOLATION,
      );
    });
  });

  describe("playlist_entries", () => {
    it("stores an entry with an id, a place and the time it was added", async () => {
      const { owner, playlistId } = await setup();

      const entry = await insertEntry(playlistId, owner);

      expect(entry["id"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(entry).toMatchObject({ position: 0, cover_url: null });
      expect(entry["added_at"]).toBeInstanceOf(Date);
    });

    it.each([
      ["a negative position", { position: -1 }],
      ["position 500: the 501st entry", { position: 500 }],
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
      const { owner, playlistId } = await setup();

      await expectPgError(insertEntry(playlistId, owner, override), PG_CHECK_VIOLATION);
    });

    it("accepts the boundary values, including the 500th place", async () => {
      const { owner, playlistId } = await setup();

      await expect(
        insertEntry(playlistId, owner, {
          position: 499,
          provider_track_id: "x".repeat(64),
          title: "x".repeat(500),
          artist: "x".repeat(500),
          duration_seconds: 0,
          cover_url: "x".repeat(2048),
        }),
      ).resolves.toBeDefined();
    });

    it("rejects a playlist that does not exist", async () => {
      const { owner } = await setup();

      await expectPgError(insertEntry(MISSING_UUID, owner), PG_FOREIGN_KEY_VIOLATION);
    });

    it("rejects an author that does not exist", async () => {
      const { playlistId } = await setup();

      await expectPgError(
        insertEntry(playlistId, MISSING_UUID),
        PG_FOREIGN_KEY_VIOLATION,
      );
    });

    it("lets the same song appear twice, as two entries", async () => {
      const { owner, playlistId } = await setup();
      const first = await insertEntry(playlistId, owner, { position: 0 });

      const second = await insertEntry(playlistId, owner, { position: 1 });

      expect(second["id"]).not.toBe(first["id"]);
    });

    it("lets two playlists use the same places", async () => {
      const { owner, playlistId } = await setup();
      const other = await insertPlaylist(owner);
      await insertEntry(playlistId, owner, { position: 0 });

      await expect(insertEntry(other, owner, { position: 0 })).resolves.toBeDefined();
    });

    describe("two entries can never share a place", () => {
      it("is refused when the check runs (here forced to run at once)", async () => {
        const { owner, playlistId } = await setup();
        await insertEntry(playlistId, owner, { position: 0 });
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");

        await expectPgError(
          insertEntry(playlistId, owner, { position: 0 }),
          PG_UNIQUE_VIOLATION,
        );
      });

      it("lets a block of entries be shifted in ONE statement, and accepts the result", async () => {
        const { owner, playlistId } = await setup();
        for (let position = 0; position < 4; position++)
          await insertEntry(playlistId, owner, { position });

        // For a moment entries 1, 2 and 3 share places with each other: only the result counts.
        await client.query(
          "UPDATE playlist_entries SET position = position + 1 WHERE playlist_id = $1 AND position >= 1",
          [playlistId],
        );
        await client.query("SET CONSTRAINTS ALL IMMEDIATE"); // run the check now

        const { rows } = await client.query(
          "SELECT position FROM playlist_entries WHERE playlist_id = $1 ORDER BY position",
          [playlistId],
        );
        expect(rows.map((r) => r.position)).toEqual([0, 2, 3, 4]);
      });

      it("refuses a shift that leaves two entries on one place", async () => {
        const { owner, playlistId } = await setup();
        for (let position = 0; position < 3; position++)
          await insertEntry(playlistId, owner, { position });

        await client.query(
          "UPDATE playlist_entries SET position = 0 WHERE playlist_id = $1 AND position = 2",
          [playlistId],
        );

        await expectPgError(
          client.query("SET CONSTRAINTS ALL IMMEDIATE"),
          PG_UNIQUE_VIOLATION,
        );
      });
    });

    it("is deleted with its playlist", async () => {
      const { owner, playlistId } = await setup();
      await insertEntry(playlistId, owner);

      await client.query("DELETE FROM playlists WHERE id = $1", [playlistId]);

      const { rows } = await client.query(
        "SELECT count(*) FROM playlist_entries WHERE playlist_id = $1",
        [playlistId],
      );
      expect(Number(rows[0].count)).toBe(0);
    });
  });

  // The uniqueness check is deferred to COMMIT, which a test that always rolls back never
  // reaches. This one really commits (and cleans up after itself).
  describe("at commit time", () => {
    it("refuses to COMMIT two entries on one place", async () => {
      await client.query("ROLLBACK"); // leave the per-test transaction
      const worker = new pg.Client({ connectionString: databaseUrl });
      await worker.connect();
      const user = (
        await worker.query(
          "INSERT INTO users (display_name) VALUES ('commit-test') RETURNING id",
        )
      ).rows[0].id;
      const playlist = (
        await worker.query(
          "INSERT INTO playlists (owner_id, name) VALUES ($1, 'P') RETURNING id",
          [user],
        )
      ).rows[0].id;
      try {
        await worker.query("BEGIN");
        for (const title of ["a", "b"]) {
          await worker.query(
            `INSERT INTO playlist_entries (playlist_id, added_by, position, provider_track_id, title, artist, duration_seconds)
             VALUES ($1, $2, 0, 'x', $3, 'a', 1)`,
            [playlist, user, title],
          ); // both on place 0: allowed inside the transaction
        }

        await expectPgError(worker.query("COMMIT"), PG_UNIQUE_VIOLATION);
      } finally {
        await worker.query("ROLLBACK");
        await worker.query("DELETE FROM users WHERE id = $1", [user]);
        await worker.end();
        await client.query("BEGIN"); // so the shared afterEach has a transaction to roll back
      }
    });
  });
});
