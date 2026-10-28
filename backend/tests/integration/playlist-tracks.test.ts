import { createServer, type Server } from "node:http";
import type { Express } from "express";
import type { PlaylistSnapshot, Track } from "@music-room/shared";
import pg from "pg";
import pino from "pino";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";
import { signAccessToken } from "../../src/modules/auth/access-token.js";
import {
  CatalogUnavailableError,
  type CatalogProvider,
} from "../../src/modules/track-vote/catalog.js";

// Reading and editing the tracks of a playlist against a real, migrated Postgres (set
// TEST_DATABASE_URL; see `make test-integration`). The catalog is a fake.
//
// Rules under test (ADR-009, ADR-018, ADR-020):
//  - editing needs the edit license (the catalog is not even asked if it is refused), reading needs only visibility;
//  - edits are expressed by intent ("after this entry"), and the list is always exactly the order the edits imply;
//  - positions are dense (0 to n-1) after every edit, however many edits run at once;
//  - the version rises by one for every edit that really changes the list, and only then;
//  - a playlist holds at most 500 entries.
const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(32);
const NAME_PREFIX = "pt-test-";
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

interface TestUser {
  id: string;
  token: string;
}

const song = (id: string): Track => ({
  providerTrackId: id,
  title: `Song ${id}`,
  artist: "Artist",
  durationSeconds: 200,
  coverUrl: null,
});

/** A small deterministic random generator, so a failing random test can be replayed. */
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe.skipIf(!databaseUrl)("playlist tracks: read, add, move, remove", () => {
  let pool: pg.Pool;
  let app: Express;
  let server: Server;
  let catalogCalls: string[];

  // A fake catalog: any id exists, except "404" (unknown) and "down" (unreachable).
  const catalog: CatalogProvider = {
    search: () => Promise.resolve([]),
    getTrack(id) {
      catalogCalls.push(id);
      if (id === "down")
        return Promise.reject(new CatalogUnavailableError("test outage"));
      if (id === "404") return Promise.resolve(null);
      return Promise.resolve(song(id));
    },
    getPreview: () => Promise.resolve({ kind: "noPreview" }),
  };

  beforeAll(() => {
    pool = createPostgresPool(databaseUrl!);
    app = buildApp();
    server = createServer(app).listen(0);
  });
  beforeEach(() => {
    catalogCalls = [];
  });
  afterEach(async () => {
    await pool.query("DELETE FROM users WHERE display_name LIKE $1", [`${NAME_PREFIX}%`]);
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });

  function buildApp(overrides: Partial<Parameters<typeof createApp>[0]> = {}): Express {
    return createApp({
      pool,
      jwtSecret: SECRET,
      logger: pino({ level: "silent" }),
      catalog,
      playlistAddLimit: { windowMs: 60_000, limit: 100_000 },
      ...overrides,
    });
  }

  async function makeUser(name: string): Promise<TestUser> {
    const { rows } = await pool.query(
      "INSERT INTO users (display_name, plan) VALUES ($1, 'premium') RETURNING id",
      [`${NAME_PREFIX}${name}`],
    );
    return {
      id: rows[0].id,
      token: await signAccessToken(rows[0].id, SECRET, { displayNameSet: true }),
    };
  }
  const call = (
    method: "get" | "post" | "delete" | "patch",
    path: string,
    user?: TestUser,
    target: Express | Server = server,
  ) => {
    const req = request(target)[method](`/api/v1${path}`);
    return user ? req.set("Authorization", `Bearer ${user.token}`) : req;
  };
  const createPlaylist = async (
    owner: TestUser,
    body: object = { name: "P" },
  ): Promise<string> => (await call("post", "/playlists", owner).send(body)).body.id;
  const add = (
    user: TestUser,
    playlistId: string,
    providerTrackId: string,
    afterEntryId?: string,
  ) =>
    call("post", `/playlists/${playlistId}/tracks`, user).send({
      providerTrackId,
      ...(afterEntryId !== undefined && { afterEntryId }),
    });
  const move = (
    user: TestUser,
    playlistId: string,
    entryId: string,
    afterEntryId: string | null,
  ) =>
    call("post", `/playlists/${playlistId}/tracks/${entryId}/move`, user).send({
      afterEntryId,
    });
  const remove = (user: TestUser, playlistId: string, entryId: string) =>
    call("delete", `/playlists/${playlistId}/tracks/${entryId}`, user);
  const snapshotOf = async (user: TestUser, playlistId: string) =>
    (await call("get", `/playlists/${playlistId}/tracks`, user)).body as PlaylistSnapshot;
  const order = (snapshot: PlaylistSnapshot) =>
    snapshot.tracks.map((t) => t.track.providerTrackId);
  const versionOf = async (playlistId: string) =>
    Number(
      (await pool.query("SELECT version FROM playlists WHERE id = $1", [playlistId]))
        .rows[0].version,
    );
  const invite = (playlistId: string, userId: string) =>
    pool.query(
      "INSERT INTO playlist_invitations (playlist_id, user_id) VALUES ($1, $2)",
      [playlistId, userId],
    );

  /** Puts entries straight into the table (no version change); returns their ids in order. */
  async function seed(
    playlistId: string,
    addedBy: TestUser,
    ids: string[],
  ): Promise<string[]> {
    const created: string[] = [];
    for (const [position, id] of ids.entries()) {
      const { rows } = await pool.query(
        `INSERT INTO playlist_entries (playlist_id, position, provider_track_id, title, artist, duration_seconds, added_by)
         VALUES ($1, $2, $3, $4, 'Artist', 200, $5) RETURNING id`, // the same data as the fake catalog's song()
        [playlistId, position, id, `Song ${id}`, addedBy.id],
      );
      created.push(rows[0].id);
    }
    return created;
  }

  /** The invariant of ADR-020: the places are exactly 0, 1, ... n-1. */
  async function expectDensePositions(playlistId: string) {
    const { rows } = await pool.query(
      "SELECT position FROM playlist_entries WHERE playlist_id = $1 ORDER BY position",
      [playlistId],
    );
    expect(rows.map((r) => r.position)).toEqual(rows.map((_, index) => index));
  }

  describe("authentication", () => {
    it.each([
      ["get", `/playlists/${MISSING_UUID}/tracks`],
      ["post", `/playlists/${MISSING_UUID}/tracks`],
      ["post", `/playlists/${MISSING_UUID}/tracks/${MISSING_UUID}/move`],
      ["delete", `/playlists/${MISSING_UUID}/tracks/${MISSING_UUID}`],
    ] as const)("%s %s requires a token", async (method, path) => {
      expect((await call(method, path)).status).toBe(401);
    });
  });

  describe("GET /playlists/{id}/tracks", () => {
    it("returns an empty list at version 0 for a new playlist", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);

      const response = await call("get", `/playlists/${playlistId}/tracks`, owner);

      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toEqual({ playlistId, version: 0, tracks: [] });
    });

    it("returns the entries in order, without ever exposing a position", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      const ids = await seed(playlistId, owner, ["a", "b", "c"]);

      const snapshot = await snapshotOf(owner, playlistId);

      expect(order(snapshot)).toEqual(["a", "b", "c"]);
      expect(snapshot.tracks.map((t) => t.id)).toEqual(ids);
      expect(snapshot.tracks[0]).toMatchObject({ addedBy: owner.id, track: song("a") });
      expect(Date.parse(snapshot.tracks[0]!.addedAt)).not.toBeNaN();
      expect(JSON.stringify(snapshot)).not.toContain("position");
    });

    it("can be read by anyone who can see the playlist, even without the right to edit", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const playlistId = await createPlaylist(owner, {
        name: "P",
        editLicense: { type: "invited_only" },
      });

      expect(
        (await call("get", `/playlists/${playlistId}/tracks`, stranger)).status,
      ).toBe(200);
    });

    it("answers a hidden private playlist exactly like a missing one, and shows it to the invited", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const stranger = await makeUser("stranger");
      const playlistId = await createPlaylist(owner, {
        name: "P",
        visibility: "private",
      });
      await invite(playlistId, guest.id);

      const hidden = await call("get", `/playlists/${playlistId}/tracks`, stranger);
      const missing = await call("get", `/playlists/${MISSING_UUID}/tracks`, stranger);

      expect(hidden.status).toBe(404);
      expect(hidden.body).toEqual(missing.body);
      expect((await call("get", `/playlists/${playlistId}/tracks`, guest)).status).toBe(
        200,
      );
    });
  });

  describe("POST /playlists/{id}/tracks (add)", () => {
    it("appends with data from the catalog and answers the new snapshot", async () => {
      const owner = await makeUser("owner");
      const author = await makeUser("author");
      const playlistId = await createPlaylist(owner);

      const response = await add(author, playlistId, "42");

      expect(response.status).toBe(201);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toMatchObject({ playlistId, version: 1 });
      expect(response.body.tracks).toHaveLength(1);
      expect(response.body.tracks[0]).toMatchObject({
        track: song("42"),
        addedBy: author.id,
      });
      expect(await versionOf(playlistId)).toBe(1);
    });

    it("keeps adding at the end, one version per addition", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);

      await add(owner, playlistId, "a");
      await add(owner, playlistId, "b");
      const last = await add(owner, playlistId, "c");

      expect(order(last.body)).toEqual(["a", "b", "c"]);
      expect(last.body.version).toBe(3);
      await expectDensePositions(playlistId);
    });

    it("inserts after an anchor: in the middle, after the first, after the last", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      const [a, b, c] = await seed(playlistId, owner, ["a", "b", "c"]);

      const middle = await add(owner, playlistId, "x", a);
      expect(order(middle.body)).toEqual(["a", "x", "b", "c"]);
      const afterLast = await add(owner, playlistId, "y", c);
      expect(order(afterLast.body)).toEqual(["a", "x", "b", "c", "y"]);
      const afterB = await add(owner, playlistId, "z", b);
      expect(order(afterB.body)).toEqual(["a", "x", "b", "z", "c", "y"]);
      await expectDensePositions(playlistId);
    });

    it("counts and places entries per playlist: other playlists' entries change nothing", async () => {
      const owner = await makeUser("owner");
      const busy = await createPlaylist(owner);
      const empty = await createPlaylist(owner);
      await seed(busy, owner, ["a", "b", "c", "d", "e"]);

      const first = await add(owner, empty, "x");
      const second = await add(owner, empty, "y");

      expect(order(first.body)).toEqual(["x"]);
      expect(order(second.body)).toEqual(["x", "y"]);
      await expectDensePositions(empty); // places 0 and 1, not 5 and 6
      await expectDensePositions(busy);
    });

    it("lets the same song appear twice, as two entries with their own ids", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);

      await add(owner, playlistId, "7");
      const second = await add(owner, playlistId, "7");

      expect(order(second.body)).toEqual(["7", "7"]);
      expect(new Set(second.body.tracks.map((t: { id: string }) => t.id)).size).toBe(2);
    });

    it("never takes title, artist or cover from the client", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);

      const response = await call("post", `/playlists/${playlistId}/tracks`, owner).send({
        providerTrackId: "1",
        title: "Hacked",
      });

      expect(response.status).toBe(400);
      expect(catalogCalls).toEqual([]);
    });

    it.each([
      ["a missing id", {}],
      ["an empty id", { providerTrackId: "" }],
      ["an id over 64 characters", { providerTrackId: "x".repeat(65) }],
      ["an id with a path in it", { providerTrackId: "../user/me" }],
      ["a numeric id", { providerTrackId: 42 }],
      ["an anchor that is not a UUID", { providerTrackId: "1", afterEntryId: "42" }],
      ["a null anchor", { providerTrackId: "1", afterEntryId: null }],
      ["an extra field", { providerTrackId: "1", position: 0 }],
    ])("answers 400 for %s", async (_label, body) => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);

      const response = await call("post", `/playlists/${playlistId}/tracks`, owner).send(
        body,
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(catalogCalls).toEqual([]);
    });

    it("answers 404 TRACK_NOT_FOUND for a track the catalog does not know, storing nothing", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);

      const response = await add(owner, playlistId, "404");

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("TRACK_NOT_FOUND");
      expect(await versionOf(playlistId)).toBe(0);
    });

    it("answers 502 PROVIDER_UNAVAILABLE when the catalog is down, storing nothing", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);

      const response = await add(owner, playlistId, "down");

      expect(response.status).toBe(502);
      expect(response.body.error.code).toBe("PROVIDER_UNAVAILABLE");
      expect(await versionOf(playlistId)).toBe(0);
    });

    describe("an anchor that is not here", () => {
      it("answers 409 ANCHOR_NOT_FOUND for an unknown anchor, changing nothing", async () => {
        const owner = await makeUser("owner");
        const playlistId = await createPlaylist(owner);
        await seed(playlistId, owner, ["a"]);

        const response = await add(owner, playlistId, "x", MISSING_UUID);

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe("ANCHOR_NOT_FOUND");
        expect(order(await snapshotOf(owner, playlistId))).toEqual(["a"]);
        expect(await versionOf(playlistId)).toBe(0);
      });

      it("treats an entry of ANOTHER playlist as not found", async () => {
        const owner = await makeUser("owner");
        const playlistId = await createPlaylist(owner);
        const otherPlaylist = await createPlaylist(owner);
        const [foreign] = await seed(otherPlaylist, owner, ["z"]);

        const response = await add(owner, playlistId, "x", foreign);

        expect(response.status).toBe(409);
        expect(order(await snapshotOf(owner, otherPlaylist))).toEqual(["z"]);
      });
    });

    describe("who may edit (the edit license)", () => {
      it("lets anyone who can see a public 'everyone' playlist", async () => {
        const owner = await makeUser("owner");
        const stranger = await makeUser("stranger");
        const playlistId = await createPlaylist(owner);

        expect((await add(stranger, playlistId, "1")).status).toBe(201);
      });

      it("refuses a stranger on an invited_only playlist with 403, never asking the catalog", async () => {
        const owner = await makeUser("owner");
        const stranger = await makeUser("stranger");
        const playlistId = await createPlaylist(owner, {
          name: "P",
          editLicense: { type: "invited_only" },
        });

        const response = await add(stranger, playlistId, "1");

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe("NOT_INVITED");
        expect(catalogCalls).toEqual([]);
        expect(await versionOf(playlistId)).toBe(0);
      });

      it("lets an invited user, and the owner, edit an invited_only playlist", async () => {
        const owner = await makeUser("owner");
        const guest = await makeUser("guest");
        const playlistId = await createPlaylist(owner, {
          name: "P",
          editLicense: { type: "invited_only" },
        });
        await invite(playlistId, guest.id);

        expect((await add(guest, playlistId, "1")).status).toBe(201);
        expect((await add(owner, playlistId, "2")).status).toBe(201);
      });

      it("answers 404 for a hidden private playlist or a missing one, never asking the catalog", async () => {
        const owner = await makeUser("owner");
        const stranger = await makeUser("stranger");
        const playlistId = await createPlaylist(owner, {
          name: "P",
          visibility: "private",
        });

        const hidden = await add(stranger, playlistId, "1");
        const missing = await add(stranger, MISSING_UUID, "1");

        expect(hidden.status).toBe(404);
        expect(hidden.body).toEqual(missing.body);
        expect(catalogCalls).toEqual([]);
      });

      it("stops a user whose invitation was removed", async () => {
        const owner = await makeUser("owner");
        const guest = await makeUser("guest");
        const playlistId = await createPlaylist(owner, {
          name: "P",
          editLicense: { type: "invited_only" },
        });
        await invite(playlistId, guest.id);
        expect((await add(guest, playlistId, "1")).status).toBe(201);

        await call("delete", `/playlists/${playlistId}/invitations/${guest.id}`, owner);

        expect((await add(guest, playlistId, "2")).status).toBe(403);
      });
    });

    describe("the 500-entry limit", () => {
      async function fullPlaylist(owner: TestUser, size: number) {
        const playlistId = await createPlaylist(owner);
        await pool.query(
          `INSERT INTO playlist_entries (playlist_id, position, provider_track_id, title, artist, duration_seconds, added_by)
           SELECT $1, n, 'seed-' || n, 'T', 'A', 1, $2 FROM generate_series(0, $3::int - 1) AS n`,
          [playlistId, owner.id, size],
        );
        return playlistId;
      }

      it("accepts the 500th entry and refuses the 501st with 409 PLAYLIST_FULL, asking no catalog", async () => {
        const owner = await makeUser("owner");
        const playlistId = await fullPlaylist(owner, 499);

        const last = await add(owner, playlistId, "last");
        catalogCalls = [];
        const tooMany = await add(owner, playlistId, "one-too-many");

        expect(last.status).toBe(201);
        expect(last.body.tracks).toHaveLength(500);
        expect(tooMany.status).toBe(409);
        expect(tooMany.body.error.code).toBe("PLAYLIST_FULL");
        expect(catalogCalls).toEqual([]);
        expect(await versionOf(playlistId)).toBe(1);
        await expectDensePositions(playlistId);
      });

      it("refuses a full playlist even when the new track is placed after an anchor", async () => {
        const owner = await makeUser("owner");
        const playlistId = await fullPlaylist(owner, 500);
        const { rows } = await pool.query(
          "SELECT id FROM playlist_entries WHERE playlist_id = $1 AND position = 10",
          [playlistId],
        );

        const response = await add(owner, playlistId, "x", rows[0].id);

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe("PLAYLIST_FULL");
        await expectDensePositions(playlistId);
      });

      it("lets exactly the free places be taken when 20 additions race for 5", async () => {
        const owner = await makeUser("owner");
        const playlistId = await fullPlaylist(owner, 495);

        const responses = await Promise.all(
          Array.from({ length: 20 }, (_, i) => add(owner, playlistId, `racer-${i}`)),
        );

        expect(responses.filter((r) => r.status === 201)).toHaveLength(5);
        expect(responses.filter((r) => r.status === 409)).toHaveLength(15);
        expect(
          new Set(
            responses.filter((r) => r.status === 409).map((r) => r.body.error.code),
          ),
        ).toEqual(new Set(["PLAYLIST_FULL"]));
        expect(
          Number(
            (
              await pool.query(
                "SELECT count(*) FROM playlist_entries WHERE playlist_id = $1",
                [playlistId],
              )
            ).rows[0].count,
          ),
        ).toBe(500);
        await expectDensePositions(playlistId);
      });
    });
  });

  describe("POST /playlists/{id}/tracks/{entryId}/move", () => {
    async function listOf(letters: string) {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      const ids = await seed(playlistId, owner, letters.split(""));
      const byLetter = Object.fromEntries(letters.split("").map((l, i) => [l, ids[i]!]));
      return { owner, playlistId, id: byLetter as Record<string, string> };
    }

    it.each([
      // [start, moved, after, expected]
      ["abcde", "c", "a", "acbde"], // up
      ["abcde", "b", "d", "acdbe"], // down
      ["abcde", "e", null, "eabcd"], // last to the start
      ["abcde", "a", "e", "bcdea"], // first to the end
      ["abcde", "d", "e", "abced"], // swap with its neighbour
      ["abcde", "b", "a", null], // already right after a: nothing changes
      ["abcde", "a", null, null], // already first: nothing changes
      ["abcde", "c", "c", null], // after itself: nothing changes
      ["ab", "b", null, "ba"],
      ["ab", "a", "b", "ba"],
    ] as const)("%s: move %s after %s", async (start, moved, after, expected) => {
      const { owner, playlistId, id } = await listOf(start);
      const versionBefore = await versionOf(playlistId);

      const response = await move(
        owner,
        playlistId,
        id[moved]!,
        after === null ? null : id[after]!,
      );

      expect(response.status).toBe(200);
      expect(order(response.body).join("")).toBe(expected ?? start);
      // A move that changes nothing must not raise the version.
      expect(response.body.version).toBe(versionBefore + (expected === null ? 0 : 1));
      expect(await versionOf(playlistId)).toBe(response.body.version);
      await expectDensePositions(playlistId);
    });

    it("keeps the entry's own id and data", async () => {
      const { owner, playlistId, id } = await listOf("abc");

      const response = await move(owner, playlistId, id["a"]!, id["c"]!);

      expect(response.body.tracks.at(-1)).toMatchObject({
        id: id["a"],
        track: song("a"),
      });
    });

    it("answers 404 TRACK_NOT_FOUND for an entry that is not here, and 409 for a missing anchor", async () => {
      const { owner, playlistId, id } = await listOf("abc");
      const versionBefore = await versionOf(playlistId);

      const noEntry = await move(owner, playlistId, MISSING_UUID, id["a"]!);
      const noAnchor = await move(owner, playlistId, id["a"]!, MISSING_UUID);

      expect(noEntry.status).toBe(404);
      expect(noEntry.body.error.code).toBe("TRACK_NOT_FOUND");
      expect(noAnchor.status).toBe(409);
      expect(noAnchor.body.error.code).toBe("ANCHOR_NOT_FOUND");
      expect(await versionOf(playlistId)).toBe(versionBefore);
      expect(order(await snapshotOf(owner, playlistId))).toEqual(["a", "b", "c"]);
    });

    it("cannot reach an entry of ANOTHER playlist through this playlist's URL", async () => {
      const { owner, playlistId, id } = await listOf("abc");
      const otherPlaylist = await createPlaylist(owner);
      const [foreign] = await seed(otherPlaylist, owner, ["z", "y"]);

      const moveForeign = await move(owner, playlistId, foreign!, null);
      const anchorForeign = await move(owner, playlistId, id["a"]!, foreign!);

      expect(moveForeign.status).toBe(404);
      expect(anchorForeign.status).toBe(409);
      expect(order(await snapshotOf(owner, otherPlaylist))).toEqual(["z", "y"]);
    });

    it.each([
      ["no body", undefined],
      ["an empty body", {}],
      ["an anchor that is not a UUID", { afterEntryId: "42" }],
      ["an extra field", { afterEntryId: null, position: 3 }],
    ])("answers 400 for %s", async (_label, body) => {
      const { owner, playlistId, id } = await listOf("abc");

      const req = call("post", `/playlists/${playlistId}/tracks/${id["a"]}/move`, owner);
      const response = await (body === undefined ? req : req.send(body));

      expect(response.status).toBe(400);
    });

    it("refuses a stranger on an invited_only playlist, and hides a private one", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const restricted = await createPlaylist(owner, {
        name: "P",
        editLicense: { type: "invited_only" },
      });
      const secret = await createPlaylist(owner, { name: "S", visibility: "private" });
      const [a, b] = await seed(restricted, owner, ["a", "b"]);
      const [s] = await seed(secret, owner, ["s", "t"]);

      expect((await move(stranger, restricted, a!, b!)).status).toBe(403);
      expect((await move(stranger, secret, s!, null)).status).toBe(404);
      expect(order(await snapshotOf(owner, restricted))).toEqual(["a", "b"]);
    });

    it("lets any editor move an entry somebody else added", async () => {
      const { playlistId, id } = await listOf("abc");
      const other = await makeUser("other");

      const response = await move(other, playlistId, id["c"]!, null);

      expect(response.status).toBe(200);
      expect(order(response.body)).toEqual(["c", "a", "b"]);
    });
  });

  describe("DELETE /playlists/{id}/tracks/{entryId}", () => {
    it("removes the entry, closes the gap and raises the version", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      const [, b] = await seed(playlistId, owner, ["a", "b", "c"]);

      const response = await remove(owner, playlistId, b!);

      expect(response.status).toBe(200);
      expect(order(response.body)).toEqual(["a", "c"]);
      expect(response.body.version).toBe(1);
      await expectDensePositions(playlistId);
    });

    it("works for the first, the last and the only entry", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      const [a, b, c] = await seed(playlistId, owner, ["a", "b", "c"]);

      expect(order((await remove(owner, playlistId, a!)).body)).toEqual(["b", "c"]);
      expect(order((await remove(owner, playlistId, c!)).body)).toEqual(["b"]);
      expect(order((await remove(owner, playlistId, b!)).body)).toEqual([]);
      await expectDensePositions(playlistId);
    });

    it("is not an error when the entry is already gone, and changes nothing", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      const [a] = await seed(playlistId, owner, ["a", "b"]);
      await remove(owner, playlistId, a!);
      const versionBefore = await versionOf(playlistId);

      const again = await remove(owner, playlistId, a!);
      const never = await remove(owner, playlistId, MISSING_UUID);

      expect(again.status).toBe(200);
      expect(never.status).toBe(200);
      expect(order(again.body)).toEqual(["b"]);
      expect(await versionOf(playlistId)).toBe(versionBefore);
    });

    it("never removes an entry of ANOTHER playlist", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      const otherPlaylist = await createPlaylist(owner);
      const [foreign] = await seed(otherPlaylist, owner, ["z"]);

      const response = await remove(owner, playlistId, foreign!);

      expect(response.status).toBe(200);
      expect(order(await snapshotOf(owner, otherPlaylist))).toEqual(["z"]);
    });

    it("refuses a stranger on an invited_only playlist, hides a private one, rejects a bad id", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const restricted = await createPlaylist(owner, {
        name: "P",
        editLicense: { type: "invited_only" },
      });
      const secret = await createPlaylist(owner, { name: "S", visibility: "private" });
      const [a] = await seed(restricted, owner, ["a"]);
      const [s] = await seed(secret, owner, ["s"]);

      expect((await remove(stranger, restricted, a!)).status).toBe(403);
      expect((await remove(stranger, secret, s!)).status).toBe(404);
      expect(
        (await call("delete", `/playlists/${restricted}/tracks/42`, owner)).status,
      ).toBe(400);
      expect(order(await snapshotOf(owner, restricted))).toEqual(["a"]);
    });
  });

  describe("the list is always what the edits imply (random edits against a simple model)", () => {
    // 150 random adds, moves and removals through the API. After EVERY one the list must equal
    // an independent model made with plain array operations (no position arithmetic), the
    // places must be dense, and the version must have risen exactly when the list changed.
    it.each([1, 2, 3])(
      "seed %i",
      async (seed) => {
        const random = seededRandom(seed);
        const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]!;
        const owner = await makeUser("owner");
        const playlistId = await createPlaylist(owner);
        const model: { id: string; song: string }[] = [];
        let expectedVersion = 0;
        let nextSong = 0;

        for (let step = 0; step < 150; step++) {
          const roll = random();
          if (roll < 0.4 || model.length < 3) {
            const anchor = model.length > 0 && random() < 0.6 ? pick(model) : null;
            const songId = `s${nextSong++}`;
            const response = await add(owner, playlistId, songId, anchor?.id);
            expect(response.status, `step ${step}: add`).toBe(201);
            const created = response.body.tracks.find(
              (t: { id: string }) => !model.some((m) => m.id === t.id),
            );
            const index = anchor
              ? model.findIndex((m) => m.id === anchor.id) + 1
              : model.length;
            model.splice(index, 0, { id: created.id, song: songId });
            expectedVersion += 1;
          } else if (roll < 0.8) {
            const entry = pick(model);
            const anchor = random() < 0.2 ? null : pick(model);
            const response = await move(owner, playlistId, entry.id, anchor?.id ?? null);
            expect(response.status, `step ${step}: move`).toBe(200);
            const before = model.map((m) => m.id).join();
            if (anchor === null || anchor.id !== entry.id) {
              model.splice(model.indexOf(entry), 1);
              model.splice(anchor ? model.indexOf(anchor) + 1 : 0, 0, entry);
            }
            if (model.map((m) => m.id).join() !== before) expectedVersion += 1;
          } else {
            const gone = random() < 0.15;
            const entry = pick(model);
            const response = await remove(
              owner,
              playlistId,
              gone ? MISSING_UUID : entry.id,
            );
            expect(response.status, `step ${step}: remove`).toBe(200);
            if (!gone) {
              model.splice(model.indexOf(entry), 1);
              expectedVersion += 1;
            }
          }

          const snapshot = await snapshotOf(owner, playlistId);
          expect(
            snapshot.tracks.map((t) => t.id),
            `step ${step}`,
          ).toEqual(model.map((m) => m.id));
          expect(snapshot.version, `step ${step}`).toBe(expectedVersion);
          await expectDensePositions(playlistId);
        }
      },
      120_000,
    );
  });

  describe("simultaneous edits (ADR-009)", () => {
    it("keeps every addition when 20 people add at once, one version each", async () => {
      const owner = await makeUser("owner");
      const users = await Promise.all(
        Array.from({ length: 20 }, (_, i) => makeUser(`adder-${i}`)),
      );
      const playlistId = await createPlaylist(owner);

      const responses = await Promise.all(
        users.map((u, i) => add(u, playlistId, `t${i}`)),
      );

      expect(responses.every((r) => r.status === 201)).toBe(true);
      const snapshot = await snapshotOf(owner, playlistId);
      expect(order(snapshot).sort()).toEqual(
        Array.from({ length: 20 }, (_, i) => `t${i}`).sort(),
      );
      expect(snapshot.version).toBe(20);
      // Every addition was applied alone, so each saw its own version: 1 to 20, each once.
      expect(responses.map((r) => r.body.version).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1),
      );
      await expectDensePositions(playlistId);
    });

    it("applies simultaneous additions after the same anchor, all of them, in arrival order", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      const [a] = await seed(playlistId, owner, ["a", "z"]);

      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, i) => add(owner, playlistId, `n${i}`, a)),
      );

      expect(responses.every((r) => r.status === 201)).toBe(true);
      const final = order(await snapshotOf(owner, playlistId));
      expect(final[0]).toBe("a");
      expect(final.at(-1)).toBe("z");
      expect(final.slice(1, -1).sort()).toEqual(
        Array.from({ length: 10 }, (_, i) => `n${i}`).sort(),
      );
      await expectDensePositions(playlistId);
    });

    it("moves DIFFERENT entries at once: all succeed and nothing is lost or duplicated", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      const letters = "abcdefghij".split("");
      const ids = await seed(playlistId, owner, letters);

      const responses = await Promise.all(
        ids.map((id, i) =>
          move(owner, playlistId, id, i % 2 === 0 ? null : ids[(i + 3) % ids.length]!),
        ),
      );

      expect(responses.every((r) => r.status === 200)).toBe(true);
      const final = order(await snapshotOf(owner, playlistId));
      expect([...final].sort()).toEqual(letters);
      await expectDensePositions(playlistId);
    });

    it("moves the SAME entry at once: all succeed, the last one applied wins, everyone ends on one list", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      const ids = await seed(playlistId, owner, "abcdefgh".split(""));
      const versionBefore = await versionOf(playlistId);

      const responses = await Promise.all(
        ids.slice(1).map((anchor) => move(owner, playlistId, ids[0]!, anchor)),
      );

      expect(responses.every((r) => r.status === 200)).toBe(true);
      const final = await snapshotOf(owner, playlistId);
      expect([...order(final)].sort()).toEqual("abcdefgh".split(""));
      // The answer of the request that was applied last IS the final list.
      const byVersion = [...responses].sort((x, y) => y.body.version - x.body.version);
      expect(order(byVersion[0]!.body)).toEqual(order(final));
      expect(final.version).toBeGreaterThan(versionBefore);
      expect(final.version).toBeLessThanOrEqual(versionBefore + responses.length);
      await expectDensePositions(playlistId);
    });

    it("mixes additions, moves and removals at once without breaking the order", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      const ids = await seed(playlistId, owner, "abcdefghij".split(""));

      const responses = await Promise.all([
        ...Array.from({ length: 8 }, (_, i) => add(owner, playlistId, `n${i}`, ids[i]!)),
        ...ids.slice(0, 5).map((id, i) => move(owner, playlistId, id, ids[9 - i]!)),
        ...ids.slice(5, 9).map((id) => remove(owner, playlistId, id)),
        ...ids.slice(5, 9).map((id) => remove(owner, playlistId, id)), // each removed twice
      ]);

      expect(
        responses.map((r) => r.status).filter((s) => ![200, 201, 409].includes(s)),
      ).toEqual([]);
      const final = await snapshotOf(owner, playlistId);
      expect(
        final.tracks.filter((t) => t.track.providerTrackId.startsWith("n")).length,
      ).toBe(responses.filter((r) => r.status === 201).length);
      for (const removed of ids.slice(5, 9))
        expect(final.tracks.some((t) => t.id === removed)).toBe(false);
      expect(new Set(final.tracks.map((t) => t.id)).size).toBe(final.tracks.length);
      await expectDensePositions(playlistId);
    });

    it("answers a clean 409 (never a 500) when the anchor is removed at the same moment", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      const ids = await seed(playlistId, owner, "abc".split(""));

      const responses = await Promise.all([
        remove(owner, playlistId, ids[1]!),
        ...Array.from({ length: 6 }, (_, i) => add(owner, playlistId, `n${i}`, ids[1]!)),
      ]);

      for (const response of responses)
        expect([200, 201, 409]).toContain(response.status);
      const final = await snapshotOf(owner, playlistId);
      expect(final.tracks.some((t) => t.id === ids[1])).toBe(false);
      await expectDensePositions(playlistId);
    });
  });

  describe("the permission is checked again under the playlist's lock", () => {
    // We hold the playlist's row lock in our own transaction, send a request, change the
    // playlist while it waits, then commit: the request must be judged on the data as it is
    // NOW, not as it was when it arrived.
    async function whileLocked<T>(
      playlistId: string,
      change: (client: pg.PoolClient) => Promise<void>,
      start: () => Promise<T>,
    ) {
      const holder = await pool.connect();
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT id FROM playlists WHERE id = $1 FOR UPDATE", [
          playlistId,
        ]);
        const pending = (start() as unknown as Promise<T>).then((response) => response);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await change(holder);
        await holder.query("COMMIT");
        return await pending;
      } finally {
        await holder.query("ROLLBACK").catch(() => undefined);
        holder.release();
      }
    }

    it("refuses an addition made just before the license became invited_only", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const playlistId = await createPlaylist(owner);

      const response = await whileLocked(
        playlistId,
        (client) =>
          client
            .query("UPDATE playlists SET edit_license = 'invited_only' WHERE id = $1", [
              playlistId,
            ])
            .then(() => undefined),
        () => add(stranger, playlistId, "1"),
      );

      expect(response.status).toBe(403);
      expect(await versionOf(playlistId)).toBe(0);
    });

    it("refuses a move and a removal made just before the playlist became private", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const playlistId = await createPlaylist(owner);
      const [a, b] = await seed(playlistId, owner, ["a", "b"]);
      const makePrivate = (client: pg.PoolClient) =>
        client
          .query("UPDATE playlists SET visibility = 'private' WHERE id = $1", [
            playlistId,
          ])
          .then(() => undefined);

      const moved = await whileLocked(playlistId, makePrivate, () =>
        move(stranger, playlistId, a!, b!),
      );
      await pool.query("UPDATE playlists SET visibility = 'public' WHERE id = $1", [
        playlistId,
      ]);
      const removed = await whileLocked(playlistId, makePrivate, () =>
        remove(stranger, playlistId, a!),
      );

      expect(moved.status).toBe(404);
      expect(removed.status).toBe(404);
      expect(order(await snapshotOf(owner, playlistId))).toEqual(["a", "b"]);
    });

    it("turns a forbidden request away at once, without waiting for the lock", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const playlistId = await createPlaylist(owner, {
        name: "P",
        editLicense: { type: "invited_only" },
      });
      const [a] = await seed(playlistId, owner, ["a"]);
      const holder = await pool.connect();
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT id FROM playlists WHERE id = $1 FOR UPDATE", [
          playlistId,
        ]);
        for (const send of [
          () => add(stranger, playlistId, "1"),
          () => move(stranger, playlistId, a!, null),
          () => remove(stranger, playlistId, a!),
        ]) {
          const answered = send().then((response) => response);
          const outcome = await Promise.race([
            answered,
            new Promise<"still waiting">((resolve) =>
              setTimeout(() => resolve("still waiting"), 700),
            ),
          ]);
          expect(outcome).not.toBe("still waiting");
          expect((outcome as request.Response).status).toBe(403);
        }
      } finally {
        await holder.query("COMMIT").catch(() => undefined);
        holder.release();
      }
    });
  });

  describe("rate limit on additions", () => {
    it("stops a flood before it reaches the catalog", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      const limited = buildApp({ playlistAddLimit: { windowMs: 60_000, limit: 2 } });

      const statuses = [];
      for (const id of ["1", "2", "3"]) {
        statuses.push(
          (
            await call("post", `/playlists/${playlistId}/tracks`, owner, limited).send({
              providerTrackId: id,
            })
          ).status,
        );
      }

      expect(statuses).toEqual([201, 201, 429]);
      expect(catalogCalls).toEqual(["1", "2"]);
    });
  });
});
