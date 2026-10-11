import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Integration tests for events, playlists and their invitation tables.
// They need a migrated database: set TEST_DATABASE_URL (see `make test-integration`),
// otherwise the whole file is skipped. Each test runs inside a transaction that is
// rolled back, so no data is left behind. Because a failed statement aborts a
// Postgres transaction, a test that expects an error has exactly one failing
// statement, and it is the last one.
const databaseUrl = process.env.TEST_DATABASE_URL;

const PG_UNIQUE_VIOLATION = "23505";
const PG_CHECK_VIOLATION = "23514";
const PG_FOREIGN_KEY_VIOLATION = "23503";

const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

type Row = Record<string, unknown>;

describe.skipIf(!databaseUrl)("events and playlists schema constraints", () => {
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

  async function insertUser(displayName = "Test User"): Promise<string> {
    const result = await client.query<{ id: string }>(
      "INSERT INTO users (display_name) VALUES ($1) RETURNING id",
      [displayName],
    );
    return result.rows[0]!.id;
  }

  /** Inserts a row built from column/value pairs and returns it. */
  async function insert(table: string, values: Row): Promise<Row> {
    const columns = Object.keys(values);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const result = await client.query<Row>(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      Object.values(values),
    );
    return result.rows[0]!;
  }

  const locationTime = {
    vote_license: "location_time",
    latitude: 48.8566,
    longitude: 2.3522,
    radius_meters: 500,
    starts_at: "2026-10-12T18:00:00Z",
    ends_at: "2026-10-12T22:00:00Z",
  };

  async function expectPgError(statement: Promise<unknown>, code: string): Promise<void> {
    await expect(statement).rejects.toMatchObject({ code });
  }

  const count = async (table: string, where: string, value: string) =>
    Number(
      (await client.query(`SELECT count(*) FROM ${table} WHERE ${where} = $1`, [value]))
        .rows[0].count,
    );

  describe("events", () => {
    it("defaults to public, vote license everyone and no location rule", async () => {
      const owner = await insertUser();

      const event = await insert("events", { owner_id: owner, name: "Friday night" });

      expect(event).toMatchObject({
        visibility: "public",
        vote_license: "everyone",
        latitude: null,
        longitude: null,
        radius_meters: null,
        starts_at: null,
        ends_at: null,
      });
      expect(event["id"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(event["created_at"]).toBeInstanceOf(Date);
    });

    it.each(["everyone", "invited_only"])(
      "accepts the %s vote license",
      async (license) => {
        const owner = await insertUser();

        await expect(
          insert("events", { owner_id: owner, name: "E", vote_license: license }),
        ).resolves.toMatchObject({ vote_license: license });
      },
    );

    it("accepts a complete location_time license", async () => {
      const owner = await insertUser();

      const event = await insert("events", {
        owner_id: owner,
        name: "E",
        ...locationTime,
      });

      expect(event).toMatchObject({ vote_license: "location_time", radius_meters: 500 });
    });

    it.each(["latitude", "longitude", "radius_meters", "starts_at", "ends_at"])(
      "rejects location_time without %s",
      async (missing) => {
        const owner = await insertUser();

        await expectPgError(
          insert("events", {
            owner_id: owner,
            name: "E",
            ...locationTime,
            [missing]: null,
          }),
          PG_CHECK_VIOLATION,
        );
      },
    );

    it.each(["everyone", "invited_only"])(
      "rejects location fields on the %s license",
      async (license) => {
        const owner = await insertUser();

        await expectPgError(
          insert("events", {
            owner_id: owner,
            name: "E",
            ...locationTime,
            vote_license: license,
          }),
          PG_CHECK_VIOLATION,
        );
      },
    );

    it.each([
      ["a latitude above 90", { latitude: 90.1 }],
      ["a latitude below -90", { latitude: -90.1 }],
      ["a longitude above 180", { longitude: 180.1 }],
      ["a longitude below -180", { longitude: -180.1 }],
      ["a radius of 0", { radius_meters: 0 }],
      ["a negative radius", { radius_meters: -5 }],
      ["a radius above 100 km", { radius_meters: 100001 }],
      ["a window that ends before it starts", { ends_at: "2026-10-12T17:00:00Z" }],
      ["a window of zero length", { ends_at: "2026-10-12T18:00:00Z" }],
    ])("rejects %s", async (_label, override) => {
      const owner = await insertUser();

      await expectPgError(
        insert("events", { owner_id: owner, name: "E", ...locationTime, ...override }),
        PG_CHECK_VIOLATION,
      );
    });

    it("accepts the extreme valid coordinates and radius", async () => {
      const owner = await insertUser();

      await expect(
        insert("events", {
          owner_id: owner,
          name: "E",
          ...locationTime,
          latitude: -90,
          longitude: 180,
          radius_meters: 100000,
        }),
      ).resolves.toBeDefined();
    });

    it.each([
      ["an unknown visibility", { visibility: "secret" }],
      ["an unknown vote license", { vote_license: "friends" }],
      ["an empty name", { name: "" }],
      ["a name over 100 characters", { name: "x".repeat(101) }],
    ])("rejects %s", async (_label, override) => {
      const owner = await insertUser();

      await expectPgError(
        insert("events", { owner_id: owner, name: "E", ...override }),
        PG_CHECK_VIOLATION,
      );
    });

    it("accepts a 100-character name and the private visibility", async () => {
      const owner = await insertUser();

      await expect(
        insert("events", {
          owner_id: owner,
          name: "x".repeat(100),
          visibility: "private",
        }),
      ).resolves.toMatchObject({ visibility: "private" });
    });

    it("rejects an owner that does not exist", async () => {
      await expectPgError(
        insert("events", { owner_id: MISSING_UUID, name: "E" }),
        PG_FOREIGN_KEY_VIOLATION,
      );
    });

    it("is deleted, with its invitations, when its owner is deleted", async () => {
      const owner = await insertUser();
      const guest = await insertUser();
      const event = await insert("events", { owner_id: owner, name: "E" });
      await insert("event_invitations", { event_id: event["id"], user_id: guest });

      await client.query("DELETE FROM users WHERE id = $1", [owner]);

      expect(await count("events", "id", String(event["id"]))).toBe(0);
      expect(await count("event_invitations", "event_id", String(event["id"]))).toBe(0);
    });
  });

  describe("event_invitations", () => {
    it("rejects inviting the same user twice (ALREADY_INVITED)", async () => {
      const owner = await insertUser();
      const guest = await insertUser();
      const event = await insert("events", { owner_id: owner, name: "E" });
      await insert("event_invitations", { event_id: event["id"], user_id: guest });

      await expectPgError(
        insert("event_invitations", { event_id: event["id"], user_id: guest }),
        PG_UNIQUE_VIOLATION,
      );
    });

    it("allows one user to be invited to different events", async () => {
      const owner = await insertUser();
      const guest = await insertUser();
      const first = await insert("events", { owner_id: owner, name: "E1" });
      const second = await insert("events", { owner_id: owner, name: "E2" });
      await insert("event_invitations", { event_id: first["id"], user_id: guest });

      await expect(
        insert("event_invitations", { event_id: second["id"], user_id: guest }),
      ).resolves.toBeDefined();
    });

    it("rejects an event that does not exist", async () => {
      const guest = await insertUser();

      await expectPgError(
        insert("event_invitations", { event_id: MISSING_UUID, user_id: guest }),
        PG_FOREIGN_KEY_VIOLATION,
      );
    });

    it("rejects a user that does not exist", async () => {
      const owner = await insertUser();
      const event = await insert("events", { owner_id: owner, name: "E" });

      await expectPgError(
        insert("event_invitations", { event_id: event["id"], user_id: MISSING_UUID }),
        PG_FOREIGN_KEY_VIOLATION,
      );
    });

    it("disappears with the invited user but leaves the event", async () => {
      const owner = await insertUser();
      const guest = await insertUser();
      const event = await insert("events", { owner_id: owner, name: "E" });
      await insert("event_invitations", { event_id: event["id"], user_id: guest });

      await client.query("DELETE FROM users WHERE id = $1", [guest]);

      expect(await count("event_invitations", "event_id", String(event["id"]))).toBe(0);
      expect(await count("events", "id", String(event["id"]))).toBe(1);
    });
  });

  describe("playlists", () => {
    it("defaults to public with edit license everyone", async () => {
      const owner = await insertUser();

      const playlist = await insert("playlists", { owner_id: owner, name: "Road trip" });

      expect(playlist).toMatchObject({ visibility: "public", edit_license: "everyone" });
    });

    it("accepts invited_only", async () => {
      const owner = await insertUser();

      await expect(
        insert("playlists", { owner_id: owner, name: "P", edit_license: "invited_only" }),
      ).resolves.toMatchObject({ edit_license: "invited_only" });
    });

    it.each([
      ["location_time (events only)", { edit_license: "location_time" }],
      ["an unknown edit license", { edit_license: "friends" }],
      ["an unknown visibility", { visibility: "secret" }],
      ["an empty name", { name: "" }],
      ["a name over 100 characters", { name: "x".repeat(101) }],
    ])("rejects %s", async (_label, override) => {
      const owner = await insertUser();

      await expectPgError(
        insert("playlists", { owner_id: owner, name: "P", ...override }),
        PG_CHECK_VIOLATION,
      );
    });

    it("is deleted, with its invitations, when its owner is deleted", async () => {
      const owner = await insertUser();
      const guest = await insertUser();
      const playlist = await insert("playlists", { owner_id: owner, name: "P" });
      await insert("playlist_invitations", {
        playlist_id: playlist["id"],
        user_id: guest,
      });

      await client.query("DELETE FROM users WHERE id = $1", [owner]);

      expect(await count("playlists", "id", String(playlist["id"]))).toBe(0);
      expect(
        await count("playlist_invitations", "playlist_id", String(playlist["id"])),
      ).toBe(0);
    });
  });

  describe("playlist_invitations", () => {
    it("rejects inviting the same user twice", async () => {
      const owner = await insertUser();
      const guest = await insertUser();
      const playlist = await insert("playlists", { owner_id: owner, name: "P" });
      await insert("playlist_invitations", {
        playlist_id: playlist["id"],
        user_id: guest,
      });

      await expectPgError(
        insert("playlist_invitations", { playlist_id: playlist["id"], user_id: guest }),
        PG_UNIQUE_VIOLATION,
      );
    });

    it("rejects a playlist that does not exist", async () => {
      const guest = await insertUser();

      await expectPgError(
        insert("playlist_invitations", { playlist_id: MISSING_UUID, user_id: guest }),
        PG_FOREIGN_KEY_VIOLATION,
      );
    });
  });

  describe("user search index", () => {
    it("serves case-insensitive prefix searches on the display name", async () => {
      await insertUser("Ada Lovelace");
      await client.query("SET LOCAL enable_seqscan = off"); // force the planner to show its index choice

      const plan = await client.query<{ "QUERY PLAN": string }>(
        "EXPLAIN SELECT id FROM users WHERE lower(display_name) LIKE 'ada%'",
      );

      expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
        "users_display_name_search_idx",
      );
    });
  });
});
