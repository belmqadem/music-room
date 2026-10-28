import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  loadEventAccess,
  loadPlaylistAccess,
} from "../../src/modules/access/repository.js";
import { decideAct } from "../../src/modules/access/rules.js";

// The loaders against a real, migrated Postgres (set TEST_DATABASE_URL; see
// `make test-integration`). Each test runs in a rolled-back transaction.
const databaseUrl = process.env.TEST_DATABASE_URL;
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!databaseUrl)("access loaders", () => {
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
      "INSERT INTO users (display_name) VALUES ('u' || md5(random()::text)) RETURNING id",
    );
    return rows[0].id;
  }
  async function insertEvent(ownerId: string, extra = ""): Promise<string> {
    const { rows } = await client.query(
      `INSERT INTO events (owner_id, name, ${extra ? extra.split("|")[0] : "visibility"})
       VALUES ($1, 'E', ${extra ? extra.split("|")[1] : "'public'"}) RETURNING id`,
      [ownerId],
    );
    return rows[0].id;
  }

  describe("loadEventAccess", () => {
    it("returns null for an event that does not exist", async () => {
      const user = await insertUser();

      expect(await loadEventAccess(client, MISSING_UUID, user)).toBeNull();
    });

    it("loads the owner, visibility and license", async () => {
      const owner = await insertUser();
      const id = await insertEvent(
        owner,
        "visibility, vote_license|'private', 'invited_only'",
      );
      const loaded = await loadEventAccess(client, id, owner);

      expect(loaded).toMatchObject({
        id,
        resource: {
          ownerId: owner,
          visibility: "private",
          license: { type: "invited_only" },
        },
        subject: { userId: owner, isInvited: false },
      });
    });

    it("reports whether THIS user is invited, and nobody else", async () => {
      const owner = await insertUser();
      const guest = await insertUser();
      const other = await insertUser();
      const id = await insertEvent(owner);
      await client.query(
        "INSERT INTO event_invitations (event_id, user_id) VALUES ($1, $2)",
        [id, guest],
      );

      expect((await loadEventAccess(client, id, guest))?.subject.isInvited).toBe(true);
      expect((await loadEventAccess(client, id, other))?.subject.isInvited).toBe(false);
      expect((await loadEventAccess(client, id, owner))?.subject.isInvited).toBe(false);
    });

    it("loads a location_time license with real dates the rules can use", async () => {
      const owner = await insertUser();
      const stranger = await insertUser();
      const { rows } = await client.query(
        `INSERT INTO events (owner_id, name, vote_license, latitude, longitude, radius_meters, starts_at, ends_at)
         VALUES ($1, 'E', 'location_time', 48.8566, 2.3522, 500, '2026-10-12T18:00:00Z', '2026-10-12T22:00:00Z')
         RETURNING id`,
        [owner],
      );
      const loaded = await loadEventAccess(client, rows[0].id, stranger);

      expect(loaded?.resource.license).toMatchObject({
        type: "location_time",
        radiusMeters: 500,
        startsAt: new Date("2026-10-12T18:00:00Z"),
        endsAt: new Date("2026-10-12T22:00:00Z"),
      });
      const position = { latitude: 48.8566, longitude: 2.3522, accuracyMeters: 10 };
      expect(
        decideAct(loaded!.resource, loaded!.subject, {
          now: new Date("2026-10-12T20:00:00Z"),
          position,
        }),
      ).toEqual({ allowed: true });
      expect(
        decideAct(loaded!.resource, loaded!.subject, {
          now: new Date("2026-10-12T23:00:00Z"),
          position,
        }),
      ).toEqual({ allowed: false, refusal: "OUTSIDE_VOTING_TIME" });
    });
  });

  describe("loadPlaylistAccess", () => {
    it("returns null for a playlist that does not exist", async () => {
      const user = await insertUser();

      expect(await loadPlaylistAccess(client, MISSING_UUID, user)).toBeNull();
    });

    it("loads the playlist and the invitation of this user", async () => {
      const owner = await insertUser();
      const guest = await insertUser();
      const { rows } = await client.query(
        `INSERT INTO playlists (owner_id, name, visibility, edit_license)
         VALUES ($1, 'P', 'private', 'invited_only') RETURNING id`,
        [owner],
      );
      const id = rows[0].id;
      await client.query(
        "INSERT INTO playlist_invitations (playlist_id, user_id) VALUES ($1, $2)",
        [id, guest],
      );

      const asGuest = await loadPlaylistAccess(client, id, guest);

      expect(asGuest).toMatchObject({
        resource: {
          ownerId: owner,
          visibility: "private",
          license: { type: "invited_only" },
        },
        subject: { userId: guest, isInvited: true },
      });
      expect((await loadPlaylistAccess(client, id, owner))?.subject.isInvited).toBe(
        false,
      );
    });

    it("does not mix up an event invitation with a playlist invitation", async () => {
      const owner = await insertUser();
      const guest = await insertUser();
      const eventId = await insertEvent(owner);
      const { rows } = await client.query(
        "INSERT INTO playlists (owner_id, name) VALUES ($1, 'P') RETURNING id",
        [owner],
      );
      await client.query(
        "INSERT INTO event_invitations (event_id, user_id) VALUES ($1, $2)",
        [eventId, guest],
      );

      expect(
        (await loadPlaylistAccess(client, rows[0].id, guest))?.subject.isInvited,
      ).toBe(false);
    });
  });
});
