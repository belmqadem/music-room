import { randomBytes } from "node:crypto";
import type { Express } from "express";
import pg from "pg";
import pino from "pino";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";
import { signAccessToken } from "../../src/modules/auth/access-token.js";
import type { CatalogProvider } from "../../src/modules/track-vote/catalog.js";

// Free and Premium (ADR-048) against a real, migrated Postgres (set TEST_DATABASE_URL). Rules
// under test: everyone starts on Free; PUT /users/me/plan switches (payment simulated) and logs
// where the switch came from; Premium is needed to create and edit playlists and to create or
// switch to an "At the venue" room, checked on every request; a downgrade keeps everything,
// read-only for the free owner, and never hides what Premium collaborators can still edit; the
// plan check never reveals a resource the caller may not see.
const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(32);
const NAME_PREFIX = `plan${randomBytes(4).toString("hex")}`;

interface TestUser {
  id: string;
  token: string;
}

const catalog: CatalogProvider = {
  search: () => Promise.resolve([]),
  getTrack: (id) =>
    Promise.resolve({
      providerTrackId: id,
      title: `Song ${id}`,
      artist: "Artist",
      durationSeconds: 180,
      coverUrl: null,
    }),
  getPreview: () => Promise.resolve({ kind: "noPreview" }),
};

const venue = {
  type: "location_time",
  latitude: 48.8566,
  longitude: 2.3522,
  radiusMeters: 500,
  startsAt: "2026-10-12T18:00:00.000Z",
  endsAt: "2026-10-12T22:00:00.000Z",
};

describe.skipIf(!databaseUrl)("plans: Free and Premium", () => {
  let pool: pg.Pool;
  let app: Express;

  beforeAll(() => {
    pool = createPostgresPool(databaseUrl!);
    app = createApp({
      pool,
      jwtSecret: SECRET,
      logger: pino({ level: "silent" }),
      catalog,
      playlistAddLimit: { windowMs: 60_000, limit: 100_000 },
    });
  });
  afterEach(async () => {
    await pool.query("DELETE FROM users WHERE display_name LIKE $1", [`${NAME_PREFIX}%`]);
  });
  afterAll(async () => {
    await pool.end();
  });

  async function makeUser(
    name: string,
    plan: "free" | "premium" = "free",
  ): Promise<TestUser> {
    const { rows } = await pool.query(
      "INSERT INTO users (display_name, display_name_set, plan) VALUES ($1, true, $2) RETURNING id",
      [`${NAME_PREFIX}${name}`, plan],
    );
    return {
      id: rows[0].id,
      token: await signAccessToken(rows[0].id, SECRET, { displayNameSet: true }),
    };
  }
  const call = (
    method: "get" | "post" | "put" | "patch" | "delete",
    path: string,
    user: TestUser,
  ) =>
    request(app)
      [method](`/api/v1${path}`)
      .set("Authorization", `Bearer ${user.token}`)
      .set("X-Platform", "android")
      .set("X-Device", "Pixel 9")
      .set("X-App-Version", "1.2.3");
  const setPlan = (user: TestUser, plan: unknown) =>
    call("put", "/users/me/plan", user).send({ plan });
  const expectPremiumRequired = (response: request.Response) => {
    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(response.body.error.code).toBe("PREMIUM_REQUIRED");
  };
  const newPlaylist = async (owner: TestUser, body: object = { name: "P" }) => {
    const response = await call("post", "/playlists", owner).send(body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.id as string;
  };
  const addTrack = (user: TestUser, playlistId: string, id = "1") =>
    call("post", `/playlists/${playlistId}/tracks`, user).send({ providerTrackId: id });

  describe("switching", () => {
    it("everyone starts on Free", async () => {
      const user = await makeUser("new");

      expect((await call("get", "/users/me", user)).body.plan).toBe("free");
    });

    it("switches to Premium and back, logging each switch with where it came from", async () => {
      const user = await makeUser("switcher");

      const up = await setPlan(user, "premium");
      const down = await setPlan(user, "free");

      expect(up.status).toBe(200);
      expect(up.body.plan).toBe("premium");
      expect(down.body.plan).toBe("free");
      const { rows } = await pool.query(
        `SELECT from_plan, to_plan, platform, device, app_version
         FROM plan_changes WHERE user_id = $1 ORDER BY changed_at`,
        [user.id],
      );
      expect(rows).toEqual([
        {
          from_plan: "free",
          to_plan: "premium",
          platform: "android",
          device: "Pixel 9",
          app_version: "1.2.3",
        },
        {
          from_plan: "premium",
          to_plan: "free",
          platform: "android",
          device: "Pixel 9",
          app_version: "1.2.3",
        },
      ]);
    });

    it("switching to the plan you already have changes nothing and logs nothing", async () => {
      const user = await makeUser("same");

      const response = await setPlan(user, "free");

      expect(response.status).toBe(200);
      const { rows } = await pool.query("SELECT 1 FROM plan_changes WHERE user_id = $1", [
        user.id,
      ]);
      expect(rows).toHaveLength(0);
    });

    it("of simultaneous switches, each logs what really changed", async () => {
      const user = await makeUser("racer");

      await Promise.all(Array.from({ length: 6 }, () => setPlan(user, "premium")));

      const { rows } = await pool.query("SELECT 1 FROM plan_changes WHERE user_id = $1", [
        user.id,
      ]);
      expect(rows).toHaveLength(1);
    });

    it.each([
      ["an unknown plan", { plan: "gold" }],
      ["no plan", {}],
      ["another user's id", { plan: "premium", userId: "x" }],
    ])("refuses %s (400)", async (_label, body) => {
      const user = await makeUser("bad");

      const response = await call("put", "/users/me/plan", user).send(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("requires authentication, and a chosen display name", async () => {
      const unnamed = await makeUser("unnamed");
      const token = await signAccessToken(unnamed.id, SECRET, { displayNameSet: false });

      expect(
        (await request(app).put("/api/v1/users/me/plan").send({ plan: "premium" }))
          .status,
      ).toBe(401);
      const refused = await request(app)
        .put("/api/v1/users/me/plan")
        .set("Authorization", `Bearer ${token}`)
        .send({ plan: "premium" });
      expect(refused.body.error.code).toBe("DISPLAY_NAME_REQUIRED");
    });
  });

  describe("the Playlist Editor is Premium", () => {
    it("a free user cannot create a playlist; Premium can", async () => {
      expectPremiumRequired(
        await call("post", "/playlists", await makeUser("free")).send({ name: "P" }),
      );
      expect(
        (
          await call("post", "/playlists", await makeUser("prem", "premium")).send({
            name: "P",
          })
        ).status,
      ).toBe(201);
    });

    it("a free collaborator of a Premium owner can see the playlist but not edit it", async () => {
      const owner = await makeUser("owner", "premium");
      const freeGuest = await makeUser("guest");
      const premiumGuest = await makeUser("pguest", "premium");
      const playlist = await newPlaylist(owner);

      expect((await call("get", `/playlists/${playlist}/tracks`, freeGuest)).status).toBe(
        200,
      );
      expectPremiumRequired(await addTrack(freeGuest, playlist));
      expect((await addTrack(premiumGuest, playlist)).status).toBe(201);
    });

    it("after a downgrade the owner keeps the playlist read-only: no edit, settings or invite", async () => {
      const owner = await makeUser("downgrader", "premium");
      const friend = await makeUser("friend");
      const playlist = await newPlaylist(owner);
      const entry = (await addTrack(owner, playlist)).body.tracks[0].id as string;
      await setPlan(owner, "free");

      expect((await call("get", `/playlists/${playlist}`, owner)).status).toBe(200);
      expectPremiumRequired(await addTrack(owner, playlist, "2"));
      expectPremiumRequired(
        await call("post", `/playlists/${playlist}/tracks/${entry}/move`, owner).send({
          afterEntryId: null,
        }),
      );
      expectPremiumRequired(
        await call("delete", `/playlists/${playlist}/tracks/${entry}`, owner),
      );
      expectPremiumRequired(
        await call("patch", `/playlists/${playlist}`, owner).send({ name: "Renamed" }),
      );
      expectPremiumRequired(
        await call("post", `/playlists/${playlist}/invitations`, owner).send({
          userId: friend.id,
        }),
      );
    });

    it("a Premium collaborator can still edit a playlist whose owner went Free", async () => {
      const owner = await makeUser("lapsed", "premium");
      const collaborator = await makeUser("collab", "premium");
      const playlist = await newPlaylist(owner);
      await setPlan(owner, "free");

      expect((await addTrack(collaborator, playlist)).status).toBe(201);
    });

    it("a free owner can always shrink what they own: remove invitations, delete the playlist", async () => {
      const owner = await makeUser("shrinker", "premium");
      const friend = await makeUser("invited");
      const playlist = await newPlaylist(owner, { name: "P", visibility: "private" });
      await call("post", `/playlists/${playlist}/invitations`, owner).send({
        userId: friend.id,
      });
      await setPlan(owner, "free");

      expect(
        (await call("delete", `/playlists/${playlist}/invitations/${friend.id}`, owner))
          .status,
      ).toBe(204);
      expect((await call("delete", `/playlists/${playlist}`, owner)).status).toBe(204);
    });

    it("the plan check never reveals a playlist the caller may not see (404, not 403)", async () => {
      const owner = await makeUser("secret", "premium");
      const stranger = await makeUser("stranger");
      const playlist = await newPlaylist(owner, { name: "P", visibility: "private" });

      const response = await addTrack(stranger, playlist);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("PLAYLIST_NOT_FOUND");
    });

    it("an upgrade counts from the very next request", async () => {
      const user = await makeUser("upgrader");
      expectPremiumRequired(await call("post", "/playlists", user).send({ name: "P" }));

      await setPlan(user, "premium");

      expect((await call("post", "/playlists", user).send({ name: "P" })).status).toBe(
        201,
      );
    });
  });

  describe('"At the venue" rooms are Premium; every other room is free', () => {
    it("a free user can create a room for everyone or for invited people, not at the venue", async () => {
      const user = await makeUser("roomer");

      expect((await call("post", "/events", user).send({ name: "R" })).status).toBe(201);
      expect(
        (
          await call("post", "/events", user).send({
            name: "R",
            voteLicense: { type: "invited_only" },
          })
        ).status,
      ).toBe(201);
      expectPremiumRequired(
        await call("post", "/events", user).send({ name: "R", voteLicense: venue }),
      );
    });

    it('Premium can create an "At the venue" room', async () => {
      const user = await makeUser("venueowner", "premium");

      expect(
        (await call("post", "/events", user).send({ name: "R", voteLicense: venue }))
          .status,
      ).toBe(201);
    });

    it("a free owner cannot turn a room into one; a downgraded owner's venue room keeps working", async () => {
      const free = await makeUser("turner");
      const room = (await call("post", "/events", free).send({ name: "R" })).body.id;
      expectPremiumRequired(
        await call("patch", `/events/${room}`, free).send({ voteLicense: venue }),
      );

      const lapsed = await makeUser("lapsedvenue", "premium");
      const venueRoom = (
        await call("post", "/events", lapsed).send({ name: "V", voteLicense: venue })
      ).body.id;
      await setPlan(lapsed, "free");
      const renamed = await call("patch", `/events/${venueRoom}`, lapsed).send({
        name: "Renamed",
      });
      expect(renamed.status).toBe(200);
      expect(renamed.body.voteLicense.type).toBe("location_time");
      expect(
        (
          await call("patch", `/events/${venueRoom}`, lapsed).send({
            voteLicense: { type: "everyone" },
          })
        ).status,
      ).toBe(200);
    });

    it("a free user can suggest and vote in any room they may vote in", async () => {
      const owner = await makeUser("host");
      const guest = await makeUser("voter");
      const room = (await call("post", "/events", owner).send({ name: "R" })).body.id;

      const suggested = await call("post", `/events/${room}/tracks`, guest).send({
        providerTrackId: "7",
      });
      expect(suggested.status, JSON.stringify(suggested.body)).toBe(201);
      const vote = await call(
        "put",
        `/events/${room}/tracks/${suggested.body.id}/vote`,
        owner,
      );
      expect(vote.status, JSON.stringify(vote.body)).toBe(200);
    });
  });
});
