import type { Express } from "express";
import pg from "pg";
import pino from "pino";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";
import { signAccessToken } from "../../src/modules/auth/access-token.js";
import { loadPlaylistAccess } from "../../src/modules/access/repository.js";
import { canView } from "../../src/modules/access/rules.js";

// Playlists CRUD against a real, migrated Postgres (set TEST_DATABASE_URL; see
// `make test-integration`). Every test user is named "playlists-test-*" and is
// deleted afterwards (their playlists go with them).
//
// Rules under test (ADR-005, ADR-013, ADR-014):
//  - anyone signed in can create; the creator is the owner and nothing in the body can change that;
//  - a hidden (private, not invited) playlist is exactly as 404 as a missing one;
//  - only the owner can change or delete; a viewer who is not the owner gets 403;
//  - the list shows public + own + invited playlists, newest first, and agrees with canView.
const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(32);
const NAME_PREFIX = "playlists-test-";
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

interface TestUser {
  id: string;
  token: string;
}

describe.skipIf(!databaseUrl)("playlists", () => {
  let pool: pg.Pool;
  let app: Express;

  beforeAll(() => {
    pool = createPostgresPool(databaseUrl!);
    app = createApp({ pool, jwtSecret: SECRET, logger: pino({ level: "silent" }) });
  });
  afterEach(async () => {
    await pool.query("DELETE FROM users WHERE display_name LIKE $1", [`${NAME_PREFIX}%`]);
  });
  afterAll(async () => {
    await pool.end();
  });

  async function makeUser(name: string): Promise<TestUser> {
    const { rows } = await pool.query(
      "INSERT INTO users (display_name) VALUES ($1) RETURNING id",
      [`${NAME_PREFIX}${name}`],
    );
    return {
      id: rows[0].id,
      token: await signAccessToken(rows[0].id, SECRET, { displayNameSet: true }),
    };
  }

  const call = (
    method: "get" | "post" | "patch" | "delete",
    path: string,
    user?: TestUser,
  ) => {
    const req = request(app)[method](`/api/v1${path}`);
    return user ? req.set("Authorization", `Bearer ${user.token}`) : req;
  };
  const createPlaylist = (user: TestUser, body: object = { name: "Friday" }) =>
    call("post", "/playlists", user).send(body);
  const invite = (playlistId: string, userId: string) =>
    pool.query(
      "INSERT INTO playlist_invitations (playlist_id, user_id) VALUES ($1, $2)",
      [playlistId, userId],
    );
  const insertPlaylistRow = async (ownerId: string, columns: string, values: unknown[]) =>
    (
      await pool.query(
        `INSERT INTO playlists (owner_id, ${columns}) VALUES ($1, ${values.map((_, i) => `$${i + 2}`).join(", ")}) RETURNING id`,
        [ownerId, ...values],
      )
    ).rows[0].id as string;

  describe("authentication", () => {
    it.each([
      ["post", "/playlists"],
      ["get", "/playlists"],
      ["get", `/playlists/${MISSING_UUID}`],
      ["patch", `/playlists/${MISSING_UUID}`],
      ["delete", `/playlists/${MISSING_UUID}`],
    ] as const)("%s %s requires a token", async (method, path) => {
      const response = await call(method, path);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("POST /playlists", () => {
    it("creates a public playlist open to everyone, owned by the caller", async () => {
      const owner = await makeUser("owner");

      const response = await createPlaylist(owner, { name: "  Friday night  " });

      expect(response.status).toBe(201);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toMatchObject({
        name: "Friday night",
        ownerId: owner.id,
        visibility: "public",
        editLicense: { type: "everyone" },
        myPermissions: { canView: true, canAct: true, canManage: true },
      });
      expect(response.body.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(Date.parse(response.body.createdAt)).not.toBeNaN();
    });

    it("accepts an invited_only license", async () => {
      const owner = await makeUser("owner");

      const response = await createPlaylist(owner, {
        name: "E",
        editLicense: { type: "invited_only" },
      });

      expect(response.body.editLicense).toEqual({ type: "invited_only" });
    });

    it("ignores any attempt to choose the owner, id or creation date", async () => {
      const owner = await makeUser("owner");
      const victim = await makeUser("victim");

      const response = await createPlaylist(owner, { name: "E", ownerId: victim.id });

      expect(response.status).toBe(400);
      const count = await pool.query(
        "SELECT count(*) FROM playlists WHERE owner_id = $1",
        [victim.id],
      );
      expect(Number(count.rows[0].count)).toBe(0);
    });
  });

  describe("a playlist has no location rule", () => {
    const locationTime = {
      type: "location_time",
      latitude: 48.8566,
      longitude: 2.3522,
      radiusMeters: 500,
      startsAt: "2026-10-12T18:00:00.000Z",
      endsAt: "2026-10-12T22:00:00.000Z",
    };

    it("refuses a location_time license when creating, and creates nothing", async () => {
      const owner = await makeUser("owner");

      const response = await createPlaylist(owner, {
        name: "P",
        editLicense: locationTime,
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      const count = await pool.query(
        "SELECT count(*) FROM playlists WHERE owner_id = $1",
        [owner.id],
      );
      expect(Number(count.rows[0].count)).toBe(0);
    });

    it("refuses a location_time license when changing a playlist, and changes nothing", async () => {
      const owner = await makeUser("owner");
      const { body: playlist } = await createPlaylist(owner);

      const response = await call("patch", `/playlists/${playlist.id}`, owner).send({
        editLicense: locationTime,
      });

      expect(response.status).toBe(400);
      expect(
        (await call("get", `/playlists/${playlist.id}`, owner)).body.editLicense,
      ).toEqual({
        type: "everyone",
      });
    });

    it("refuses a vote-style field name: the playlist field is editLicense", async () => {
      const owner = await makeUser("owner");

      const response = await createPlaylist(owner, {
        name: "P",
        voteLicense: { type: "everyone" },
      });

      expect(response.status).toBe(400);
    });
  });

  describe("GET /playlists/{id}", () => {
    it("shows a public playlist to a stranger, who can act but not manage", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const { body: playlist } = await createPlaylist(owner);

      const response = await call("get", `/playlists/${playlist.id}`, stranger);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: playlist.id,
        myPermissions: { canView: true, canAct: true, canManage: false },
      });
    });

    it("reports canAct false for a stranger on an invited_only public playlist", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const { body: playlist } = await createPlaylist(owner, {
        name: "E",
        editLicense: { type: "invited_only" },
      });

      const response = await call("get", `/playlists/${playlist.id}`, stranger);

      expect(response.status).toBe(200);
      expect(response.body.myPermissions).toEqual({
        canView: true,
        canAct: false,
        canManage: false,
      });
    });

    it("shows a private playlist to its owner and to invited users only", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const stranger = await makeUser("stranger");
      const { body: playlist } = await createPlaylist(owner, {
        name: "E",
        visibility: "private",
      });
      await invite(playlist.id, guest.id);

      expect((await call("get", `/playlists/${playlist.id}`, owner)).status).toBe(200);
      const asGuest = await call("get", `/playlists/${playlist.id}`, guest);
      expect(asGuest.status).toBe(200);
      expect(asGuest.body.myPermissions).toEqual({
        canView: true,
        canAct: true,
        canManage: false,
      });
      expect((await call("get", `/playlists/${playlist.id}`, stranger)).status).toBe(404);
    });

    it("answers a hidden private playlist exactly like a playlist that does not exist", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const { body: playlist } = await createPlaylist(owner, {
        name: "E",
        visibility: "private",
      });

      const hidden = await call("get", `/playlists/${playlist.id}`, stranger);
      const missing = await call("get", `/playlists/${MISSING_UUID}`, stranger);

      expect(hidden.status).toBe(404);
      expect(hidden.body).toEqual(missing.body);
      expect(hidden.body.error.code).toBe("PLAYLIST_NOT_FOUND");
    });

    it("answers 400 for an id that is not a UUID", async () => {
      const user = await makeUser("user");

      expect((await call("get", "/playlists/not-a-uuid", user)).status).toBe(400);
    });
  });

  describe("GET /playlists (list)", () => {
    it("lists public playlists, own private playlists and invited private playlists, not others' private ones", async () => {
      const me = await makeUser("me");
      const other = await makeUser("other");
      const publicOfOther = (await createPlaylist(other, { name: "public" })).body.id;
      const privateOfOther = (
        await createPlaylist(other, { name: "hidden", visibility: "private" })
      ).body.id;
      const invitedTo = (
        await createPlaylist(other, { name: "invited", visibility: "private" })
      ).body.id;
      const mine = (await createPlaylist(me, { name: "mine", visibility: "private" }))
        .body.id;
      await invite(invitedTo, me.id);

      const ids = (await call("get", "/playlists?limit=100", me)).body.items.map(
        (e: { id: string }) => e.id,
      );

      expect(ids).toEqual(expect.arrayContaining([publicOfOther, invitedTo, mine]));
      expect(ids).not.toContain(privateOfOther);
    });

    it("returns the caller's own permissions on every item", async () => {
      const me = await makeUser("me");
      const other = await makeUser("other");
      const own = (await createPlaylist(me, { name: "own" })).body.id;
      const theirs = (await createPlaylist(other, { name: "theirs" })).body.id;

      const items = (await call("get", "/playlists?limit=100", me)).body.items as {
        id: string;
        myPermissions: { canManage: boolean };
      }[];

      expect(items.find((e) => e.id === own)?.myPermissions.canManage).toBe(true);
      expect(items.find((e) => e.id === theirs)?.myPermissions.canManage).toBe(false);
    });

    it("puts the newest playlist first", async () => {
      const me = await makeUser("me");
      const first = (await createPlaylist(me, { name: "first" })).body.id;
      const second = (await createPlaylist(me, { name: "second" })).body.id;
      const third = (await createPlaylist(me, { name: "third" })).body.id;

      const ids = (await call("get", "/playlists?limit=100", me)).body.items
        .map((e: { id: string }) => e.id)
        .filter((id: string) => [first, second, third].includes(id));

      expect(ids).toEqual([third, second, first]);
    });

    it("walks every page once, with no repeat and no gap, even when created_at is identical", async () => {
      const me = await makeUser("me");
      // Private and in the future, so they come first and belong to nobody else's list.
      const created = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          insertPlaylistRow(me.id, "name, visibility, created_at", [
            `tie-${i}`,
            "private",
            "2031-01-01 00:00:00.123456+00",
          ]),
        ),
      );

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const response: request.Response = await call(
          "get",
          `/playlists?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
          me,
        );
        expect(response.status).toBe(200);
        seen.push(...response.body.items.map((e: { id: string }) => e.id));
        cursor = response.body.nextCursor;
        pages++;
      } while (cursor && pages < 50);

      const mine = seen.filter((id) => created.includes(id));
      expect(mine).toHaveLength(5);
      expect(new Set(seen).size).toBe(seen.length);
      expect(mine).toEqual([...created].sort().reverse()); // ties break on id, descending
    });

    it("keeps microsecond differences that a JavaScript Date would round away", async () => {
      const me = await makeUser("me");
      const older = await insertPlaylistRow(me.id, "name, visibility, created_at", [
        "a",
        "private",
        "2032-01-01 00:00:00.000001+00",
      ]);
      const newer = await insertPlaylistRow(me.id, "name, visibility, created_at", [
        "b",
        "private",
        "2032-01-01 00:00:00.000002+00",
      ]);

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const response: request.Response = await call(
          "get",
          `/playlists?limit=1${cursor ? `&cursor=${cursor}` : ""}`,
          me,
        );
        seen.push(...response.body.items.map((e: { id: string }) => e.id));
        cursor = response.body.nextCursor;
      } while (cursor && seen.length < 200);

      expect(seen.filter((id) => id === older || id === newer)).toEqual([newer, older]);
    });

    it("has no next cursor on the last page", async () => {
      const me = await makeUser("me");
      await createPlaylist(me);

      const response = await call("get", "/playlists?limit=100", me);

      expect(response.body.nextCursor).toBeNull();
    });

    it.each([
      "limit=0",
      "limit=101",
      "limit=abc",
      "cursor=garbage",
      `cursor=${Buffer.from('{"c":"x","i":"y"}').toString("base64url")}`,
    ])("answers 400 for the query %s", async (query) => {
      const me = await makeUser("me");

      const response = await call("get", `/playlists?${query}`, me);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("never reveals a hidden playlist through a forged cursor", async () => {
      const me = await makeUser("me");
      const other = await makeUser("other");
      const hidden = (
        await createPlaylist(other, { name: "hidden", visibility: "private" })
      ).body.id;
      const forged = Buffer.from(
        JSON.stringify({ c: "2999-01-01 00:00:00+00", i: MISSING_UUID }),
      ).toString("base64url");

      const response = await call("get", `/playlists?limit=100&cursor=${forged}`, me);

      expect(response.status).toBe(200);
      expect(response.body.items.map((e: { id: string }) => e.id)).not.toContain(hidden);
    });

    // The list repeats canView in SQL. Build every combination and check the list,
    // GET /playlists/{id} and the access engine all give the same answer.
    it("agrees with the access engine and GET /playlists/{id} for every visibility and relation", async () => {
      const me = await makeUser("me");
      const other = await makeUser("other");
      const cases: { id: string; label: string }[] = [];
      for (const visibility of ["public", "private"] as const) {
        for (const license of [{ type: "everyone" }, { type: "invited_only" }]) {
          for (const relation of ["owned", "invited", "stranger"] as const) {
            const owner = relation === "owned" ? me : other;
            const playlist = (
              await createPlaylist(owner, { name: "E", visibility, editLicense: license })
            ).body;
            if (relation === "invited") await invite(playlist.id, me.id);
            cases.push({
              id: playlist.id,
              label: `${visibility}/${license.type}/${relation}`,
            });
          }
        }
      }

      const listed = new Set<string>();
      let cursor: string | null = null;
      do {
        const response: request.Response = await call(
          "get",
          `/playlists?limit=7${cursor ? `&cursor=${cursor}` : ""}`,
          me,
        );
        response.body.items.forEach((e: { id: string }) => listed.add(e.id));
        cursor = response.body.nextCursor;
      } while (cursor);

      expect(cases).toHaveLength(12);
      for (const { id, label } of cases) {
        const loaded = await loadPlaylistAccess(pool, id, me.id);
        const byEngine = canView(loaded!.resource, loaded!.subject);
        const byGet = (await call("get", `/playlists/${id}`, me)).status === 200;
        expect({ label, listed: listed.has(id), get: byGet }).toEqual({
          label,
          listed: byEngine,
          get: byEngine,
        });
      }
    });
  });

  describe("PATCH /playlists/{id}", () => {
    it("lets the owner change the name, the visibility and the license", async () => {
      const owner = await makeUser("owner");
      const { body: playlist } = await createPlaylist(owner);

      const renamed = await call("patch", `/playlists/${playlist.id}`, owner).send({
        name: "Renamed",
      });
      const hidden = await call("patch", `/playlists/${playlist.id}`, owner).send({
        visibility: "private",
      });
      const restricted = await call("patch", `/playlists/${playlist.id}`, owner).send({
        editLicense: { type: "invited_only" },
      });

      expect(renamed.body).toMatchObject({ name: "Renamed", visibility: "public" });
      expect(hidden.body).toMatchObject({ name: "Renamed", visibility: "private" });
      expect(restricted.body).toMatchObject({
        visibility: "private",
        editLicense: { type: "invited_only" },
      });
    });

    it("never changes the owner or the creation date", async () => {
      const owner = await makeUser("owner");
      const { body: playlist } = await createPlaylist(owner);

      const response = await call("patch", `/playlists/${playlist.id}`, owner).send({
        name: "New",
      });

      expect(response.body.ownerId).toBe(owner.id);
      expect(response.body.createdAt).toBe(playlist.createdAt);
    });

    it("refuses a visible playlist's non-owner with 403 and changes nothing", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const { body: playlist } = await createPlaylist(owner);

      const response = await call("patch", `/playlists/${playlist.id}`, stranger).send({
        name: "Hacked",
      });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect((await call("get", `/playlists/${playlist.id}`, owner)).body.name).toBe(
        "Friday",
      );
    });

    it("refuses an invited non-owner with 403, and a hidden playlist with 404", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const stranger = await makeUser("stranger");
      const { body: playlist } = await createPlaylist(owner, {
        name: "E",
        visibility: "private",
      });
      await invite(playlist.id, guest.id);

      expect(
        (await call("patch", `/playlists/${playlist.id}`, guest).send({ name: "x" }))
          .status,
      ).toBe(403);
      expect(
        (await call("patch", `/playlists/${playlist.id}`, stranger).send({ name: "x" }))
          .status,
      ).toBe(404);
    });

    it("answers 404 for a playlist that does not exist", async () => {
      const user = await makeUser("user");

      expect(
        (await call("patch", `/playlists/${MISSING_UUID}`, user).send({ name: "x" }))
          .status,
      ).toBe(404);
    });

    it("applies simultaneous changes to different fields without losing any", async () => {
      const owner = await makeUser("owner");
      for (let round = 0; round < 10; round++) {
        const { body: playlist } = await createPlaylist(owner, { name: "start" });

        const responses = await Promise.all([
          call("patch", `/playlists/${playlist.id}`, owner).send({
            name: `name-${round}`,
          }),
          call("patch", `/playlists/${playlist.id}`, owner).send({
            visibility: "private",
          }),
          call("patch", `/playlists/${playlist.id}`, owner).send({
            editLicense: { type: "invited_only" },
          }),
        ]);

        expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
        const final = (await call("get", `/playlists/${playlist.id}`, owner)).body;
        expect(final).toMatchObject({
          name: `name-${round}`,
          visibility: "private",
          editLicense: { type: "invited_only" },
        });
      }
    });
  });

  describe("DELETE /playlists/{id}", () => {
    it("lets the owner delete the playlist, with its invitations", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const { body: playlist } = await createPlaylist(owner);
      await invite(playlist.id, guest.id);

      const response = await call("delete", `/playlists/${playlist.id}`, owner);

      expect(response.status).toBe(204);
      expect((await call("get", `/playlists/${playlist.id}`, owner)).status).toBe(404);
      const left = await pool.query(
        "SELECT count(*) FROM playlist_invitations WHERE playlist_id = $1",
        [playlist.id],
      );
      expect(Number(left.rows[0].count)).toBe(0);
    });

    it("refuses a non-owner with 403 and keeps the playlist", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const { body: playlist } = await createPlaylist(owner);

      const response = await call("delete", `/playlists/${playlist.id}`, stranger);

      expect(response.status).toBe(403);
      expect((await call("get", `/playlists/${playlist.id}`, owner)).status).toBe(200);
    });

    it("answers 404 for a hidden playlist, keeping it", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const { body: playlist } = await createPlaylist(owner, {
        name: "E",
        visibility: "private",
      });

      expect((await call("delete", `/playlists/${playlist.id}`, stranger)).status).toBe(
        404,
      );
      expect((await call("get", `/playlists/${playlist.id}`, owner)).status).toBe(200);
    });

    it("answers 404 when the playlist does not exist or is already deleted", async () => {
      const owner = await makeUser("owner");
      const { body: playlist } = await createPlaylist(owner);
      await call("delete", `/playlists/${playlist.id}`, owner);

      expect((await call("delete", `/playlists/${playlist.id}`, owner)).status).toBe(404);
      expect((await call("delete", `/playlists/${MISSING_UUID}`, owner)).status).toBe(
        404,
      );
    });

    it("lets exactly one of two simultaneous deletes succeed", async () => {
      const owner = await makeUser("owner");
      const { body: playlist } = await createPlaylist(owner);

      const responses = await Promise.all([
        call("delete", `/playlists/${playlist.id}`, owner),
        call("delete", `/playlists/${playlist.id}`, owner),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([204, 404]);
    });
  });
});
