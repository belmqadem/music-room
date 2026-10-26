import type { Express } from "express";
import pg from "pg";
import pino from "pino";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";
import { signAccessToken } from "../../src/modules/auth/access-token.js";

// Playlist invitations against a real, migrated Postgres (set TEST_DATABASE_URL).
// Rules under test (ADR-005, ADR-013, ADR-014):
//  - only the owner can list, add and remove invitations (403 for a viewer, 404 if hidden);
//  - an invitation takes effect immediately and a removal takes effect immediately;
//  - inviting twice is 409 ALREADY_INVITED, even when two requests race;
//  - the owner never sees an invitee's email.
const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(32);
const NAME_PREFIX = "plinv-test-";
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

interface TestUser {
  id: string;
  token: string;
}

describe.skipIf(!databaseUrl)("playlist invitations", () => {
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

  async function makeUser(name: string, email: string | null = null): Promise<TestUser> {
    const { rows } = await pool.query(
      "INSERT INTO users (display_name, email) VALUES ($1, $2) RETURNING id",
      [`${NAME_PREFIX}${name}`, email],
    );
    return {
      id: rows[0].id,
      token: await signAccessToken(rows[0].id, SECRET, { displayNameSet: true }),
    };
  }
  const call = (method: "get" | "post" | "delete", path: string, user?: TestUser) => {
    const req = request(app)[method](`/api/v1${path}`);
    return user ? req.set("Authorization", `Bearer ${user.token}`) : req;
  };
  const createPlaylist = async (
    owner: TestUser,
    body: object = { name: "E" },
  ): Promise<string> => (await call("post", "/playlists", owner).send(body)).body.id;
  const invite = (owner: TestUser, playlistId: string, userId: string) =>
    call("post", `/playlists/${playlistId}/invitations`, owner).send({ userId });

  describe("authentication", () => {
    it.each([
      ["get", `/playlists/${MISSING_UUID}/invitations`],
      ["post", `/playlists/${MISSING_UUID}/invitations`],
      ["delete", `/playlists/${MISSING_UUID}/invitations/${MISSING_UUID}`],
    ] as const)("%s %s requires a token", async (method, path) => {
      const response = await call(method, path);

      expect(response.status).toBe(401);
    });
  });

  describe("POST /playlists/{id}/invitations", () => {
    it("invites a user and returns only their id and display name", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest", "guest.secret@playlist-invite.invalid");
      const playlistId = await createPlaylist(owner);

      const response = await invite(owner, playlistId, guest.id);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        resourceId: playlistId,
        user: { id: guest.id, displayName: `${NAME_PREFIX}guest` },
        invitedAt: expect.any(String),
      });
      expect(Date.parse(response.body.invitedAt)).not.toBeNaN();
      expect(JSON.stringify(response.body)).not.toContain("guest.secret");
    });

    it("gives the invited user access at once, and a removal takes it away at once", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const playlistId = await createPlaylist(owner, {
        name: "E",
        visibility: "private",
      });
      expect((await call("get", `/playlists/${playlistId}`, guest)).status).toBe(404);

      await invite(owner, playlistId, guest.id);
      const visible = await call("get", `/playlists/${playlistId}`, guest);
      const listed = (await call("get", "/playlists?limit=100", guest)).body.items.map(
        (e: { id: string }) => e.id,
      );

      expect(visible.status).toBe(200);
      expect(visible.body.myPermissions).toEqual({
        canView: true,
        canAct: true,
        canManage: false,
      });
      expect(listed).toContain(playlistId);

      await call("delete", `/playlists/${playlistId}/invitations/${guest.id}`, owner);
      expect((await call("get", `/playlists/${playlistId}`, guest)).status).toBe(404);
      expect(
        (await call("get", "/playlists?limit=100", guest)).body.items.map(
          (e: { id: string }) => e.id,
        ),
      ).not.toContain(playlistId);
    });

    it("lets an invited user act on a public invited_only playlist", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const playlistId = await createPlaylist(owner, {
        name: "E",
        editLicense: { type: "invited_only" },
      });
      expect(
        (await call("get", `/playlists/${playlistId}`, guest)).body.myPermissions.canAct,
      ).toBe(false);

      await invite(owner, playlistId, guest.id);

      expect(
        (await call("get", `/playlists/${playlistId}`, guest)).body.myPermissions.canAct,
      ).toBe(true);
    });

    it("answers 409 ALREADY_INVITED the second time", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const playlistId = await createPlaylist(owner);
      await invite(owner, playlistId, guest.id);

      const response = await invite(owner, playlistId, guest.id);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("ALREADY_INVITED");
    });

    it("lets exactly one of several simultaneous identical invitations succeed", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const playlistId = await createPlaylist(owner);

      const responses = await Promise.all(
        Array.from({ length: 6 }, () => invite(owner, playlistId, guest.id)),
      );

      expect(responses.map((r) => r.status).sort()).toEqual([
        201, 409, 409, 409, 409, 409,
      ]);
      const rows = await pool.query(
        "SELECT count(*) FROM playlist_invitations WHERE playlist_id = $1",
        [playlistId],
      );
      expect(Number(rows.rows[0].count)).toBe(1);
    });

    it("answers 404 for a user that does not exist", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);

      const response = await invite(owner, playlistId, MISSING_UUID);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("refuses to invite the owner", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);

      const response = await invite(owner, playlistId, owner.id);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it.each([
      ["a missing userId", {}],
      ["a userId that is not a UUID", { userId: "42" }],
      ["a numeric userId", { userId: 42 }],
      ["an extra field", { userId: MISSING_UUID, role: "admin" }],
    ])("answers 400 for %s", async (_label, body) => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);

      const response = await call(
        "post",
        `/playlists/${playlistId}/invitations`,
        owner,
      ).send(body);

      expect(response.status).toBe(400);
    });

    it("refuses a viewer who is not the owner with 403, and invites nobody", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const friend = await makeUser("friend");
      const playlistId = await createPlaylist(owner);

      const response = await invite(stranger, playlistId, friend.id);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(
        (await call("get", `/playlists/${playlistId}/invitations`, owner)).body.items,
      ).toEqual([]);
    });

    it("does not let an invited user invite others", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const friend = await makeUser("friend");
      const playlistId = await createPlaylist(owner, {
        name: "E",
        visibility: "private",
      });
      await invite(owner, playlistId, guest.id);

      expect((await invite(guest, playlistId, friend.id)).status).toBe(403);
    });

    it("answers 404 to someone who cannot see the playlist, and for a missing playlist", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const playlistId = await createPlaylist(owner, {
        name: "E",
        visibility: "private",
      });

      expect((await invite(stranger, playlistId, owner.id)).status).toBe(404);
      expect((await invite(owner, MISSING_UUID, stranger.id)).status).toBe(404);
    });
  });

  describe("GET /playlists/{id}/invitations", () => {
    it("lists the invited users, newest invitation first", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      const guests = [];
      for (const name of ["a", "b", "c"]) {
        const guest = await makeUser(name);
        guests.push(guest.id);
        await invite(owner, playlistId, guest.id);
      }

      const response = await call("get", `/playlists/${playlistId}/invitations`, owner);

      expect(response.status).toBe(200);
      expect(response.body.items.map((i: { user: { id: string } }) => i.user.id)).toEqual(
        [...guests].reverse(),
      );
      expect(response.body.nextCursor).toBeNull();
    });

    it("never includes emails or linked providers", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest", "hidden.address@playlist-invite.invalid");
      const playlistId = await createPlaylist(owner);
      await invite(owner, playlistId, guest.id);

      const response = await call("get", `/playlists/${playlistId}/invitations`, owner);

      expect(Object.keys(response.body.items[0].user).sort()).toEqual([
        "displayName",
        "id",
      ]);
      expect(JSON.stringify(response.body)).not.toContain("hidden.address");
    });

    it("walks every page once", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      const guests = [];
      for (let i = 0; i < 5; i++) {
        const guest = await makeUser(`g${i}`);
        guests.push(guest.id);
        await invite(owner, playlistId, guest.id);
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const response: request.Response = await call(
          "get",
          `/playlists/${playlistId}/invitations?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
          owner,
        );
        seen.push(...response.body.items.map((i: { user: { id: string } }) => i.user.id));
        cursor = response.body.nextCursor;
        pages++;
      } while (cursor && pages < 10);

      expect(pages).toBe(3);
      expect([...seen].sort()).toEqual([...guests].sort());
    });

    it("answers 400 for a bad cursor or limit", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);

      expect(
        (await call("get", `/playlists/${playlistId}/invitations?cursor=garbage`, owner))
          .status,
      ).toBe(400);
      expect(
        (await call("get", `/playlists/${playlistId}/invitations?limit=0`, owner)).status,
      ).toBe(400);
    });

    it("is for the owner only: 403 for an invited user and for a viewer, 404 when hidden", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const stranger = await makeUser("stranger");
      const publicPlaylist = await createPlaylist(owner);
      const privatePlaylist = await createPlaylist(owner, {
        name: "P",
        visibility: "private",
      });
      await invite(owner, privatePlaylist, guest.id);

      expect(
        (await call("get", `/playlists/${privatePlaylist}/invitations`, guest)).status,
      ).toBe(403);
      expect(
        (await call("get", `/playlists/${publicPlaylist}/invitations`, stranger)).status,
      ).toBe(403);
      expect(
        (await call("get", `/playlists/${privatePlaylist}/invitations`, stranger)).status,
      ).toBe(404);
      expect(
        (await call("get", `/playlists/${MISSING_UUID}/invitations`, owner)).status,
      ).toBe(404);
    });
  });

  describe("DELETE /playlists/{id}/invitations/{userId}", () => {
    it("removes the invitation and answers 204, again on repeat", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const playlistId = await createPlaylist(owner);
      await invite(owner, playlistId, guest.id);

      const first = await call(
        "delete",
        `/playlists/${playlistId}/invitations/${guest.id}`,
        owner,
      );
      const second = await call(
        "delete",
        `/playlists/${playlistId}/invitations/${guest.id}`,
        owner,
      );

      expect(first.status).toBe(204);
      expect(second.status).toBe(204);
      expect(
        (await call("get", `/playlists/${playlistId}/invitations`, owner)).body.items,
      ).toEqual([]);
    });

    it("only touches the invitation of the playlist in the URL", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const first = await createPlaylist(owner);
      const second = await createPlaylist(owner);
      await invite(owner, first, guest.id);
      await invite(owner, second, guest.id);

      await call("delete", `/playlists/${first}/invitations/${guest.id}`, owner);

      expect(
        (await call("get", `/playlists/${second}/invitations`, owner)).body.items,
      ).toHaveLength(1);
    });

    it("refuses a non-owner with 403 (invitation kept) and a hidden playlist with 404", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const stranger = await makeUser("stranger");
      const publicPlaylist = await createPlaylist(owner);
      const privatePlaylist = await createPlaylist(owner, {
        name: "P",
        visibility: "private",
      });
      await invite(owner, publicPlaylist, guest.id);
      await invite(owner, privatePlaylist, guest.id);

      expect(
        (
          await call(
            "delete",
            `/playlists/${publicPlaylist}/invitations/${guest.id}`,
            stranger,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await call(
            "delete",
            `/playlists/${privatePlaylist}/invitations/${guest.id}`,
            stranger,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call(
            "delete",
            `/playlists/${privatePlaylist}/invitations/${guest.id}`,
            guest,
          )
        ).status,
      ).toBe(403);
      expect(
        (await call("get", `/playlists/${publicPlaylist}/invitations`, owner)).body.items,
      ).toHaveLength(1);
      expect(
        (await call("get", `/playlists/${privatePlaylist}/invitations`, owner)).body
          .items,
      ).toHaveLength(1);
    });

    it("answers 400 for a malformed user id and 404 for a missing playlist", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);

      expect(
        (await call("delete", `/playlists/${playlistId}/invitations/42`, owner)).status,
      ).toBe(400);
      expect(
        (
          await call(
            "delete",
            `/playlists/${MISSING_UUID}/invitations/${MISSING_UUID}`,
            owner,
          )
        ).status,
      ).toBe(404);
    });
  });

  it("deletes the invitations of a deleted playlist and keeps the invited users", async () => {
    const owner = await makeUser("owner");
    const guest = await makeUser("guest");
    const playlistId = await createPlaylist(owner);
    await invite(owner, playlistId, guest.id);

    await call("delete", `/playlists/${playlistId}`, owner);

    expect(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM playlist_invitations WHERE playlist_id = $1",
            [playlistId],
          )
        ).rows[0].count,
      ),
    ).toBe(0);
    expect(
      (await pool.query("SELECT 1 FROM users WHERE id = $1", [guest.id])).rowCount,
    ).toBe(1);
  });
});
