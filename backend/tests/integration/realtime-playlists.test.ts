import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  AccessLost,
  PlaylistSnapshot,
  SubscribeAck,
  Track,
} from "@music-room/shared";
import pg from "pg";
import pino from "pino";
import { io as connect, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";
import { signAccessToken } from "../../src/modules/auth/access-token.js";
import type { CatalogProvider } from "../../src/modules/track-vote/catalog.js";
import { MAX_SUBSCRIPTIONS_PER_SOCKET } from "../../src/sockets/authenticated-namespace.js";
import { createRealtime } from "../../src/sockets/index.js";
import { Inbox } from "../helpers/socket-inbox.js";

// Live playlists with a REAL Socket.io server and client over a real Postgres (set
// TEST_DATABASE_URL; see `make test-integration`). The catalog is a fake.
//
// Rules under test (ADR-019, ADR-020):
//  - following a playlist needs the same right to SEE it as REST, and a hidden one looks missing;
//  - the acknowledgement brings the current ordered tracks and version; every edit that really
//    changes the list is then sent as ONE shared snapshot to the people following it, and
//    only to them;
//  - losing access (invitation withdrawn, playlist made private or deleted) removes the socket
//    from that playlist's channel, and only from that one;
//  - events and playlists never get mixed up.
const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(32);
const NAME_PREFIX = "rtp-test-";
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

describe.skipIf(!databaseUrl)("real-time playlist updates", () => {
  let pool: pg.Pool;
  let httpServer: Server;
  let io: ReturnType<typeof createRealtime>["io"];
  let baseUrl: string;
  const sockets: Socket[] = [];

  const catalog: CatalogProvider = {
    search: () => Promise.resolve([]),
    getTrack: (id) => Promise.resolve(song(id)),
  };

  beforeAll(async () => {
    pool = createPostgresPool(databaseUrl!);
    const realtime = createRealtime({
      jwtSecret: SECRET,
      logger: pino({ level: "silent" }),
      pool,
    });
    const app = createApp({
      pool,
      jwtSecret: SECRET,
      logger: pino({ level: "silent" }),
      catalog,
      realtime: realtime.events,
      playlistAddLimit: { windowMs: 60_000, limit: 100_000 },
      suggestLimit: { windowMs: 60_000, limit: 100_000 },
    });
    httpServer = createServer(app);
    io = realtime.io;
    io.attach(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    baseUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.close());
    await pool.query("DELETE FROM users WHERE display_name LIKE $1", [`${NAME_PREFIX}%`]);
  });
  afterAll(async () => {
    await io.close(); // also closes the HTTP server
    await pool.end();
  });

  async function makeUser(name: string): Promise<TestUser> {
    const { rows } = await pool.query(
      "INSERT INTO users (display_name) VALUES ($1) RETURNING id",
      [`${NAME_PREFIX}${name}`],
    );
    return { id: rows[0].id, token: await signAccessToken(rows[0].id, SECRET) };
  }
  const rest = (
    method: "get" | "post" | "put" | "delete" | "patch",
    path: string,
    user: TestUser,
  ) =>
    request(httpServer)
      [method](`/api/v1${path}`)
      .set("Authorization", `Bearer ${user.token}`);
  const createPlaylist = async (
    owner: TestUser,
    body: object = { name: "P" },
  ): Promise<string> => (await rest("post", "/playlists", owner).send(body)).body.id;
  const createEvent = async (
    owner: TestUser,
    body: object = { name: "E" },
  ): Promise<string> => (await rest("post", "/events", owner).send(body)).body.id;
  const addTrack = async (
    user: TestUser,
    playlistId: string,
    providerTrackId: string,
    afterEntryId?: string,
  ) =>
    rest("post", `/playlists/${playlistId}/tracks`, user).send({
      providerTrackId,
      ...(afterEntryId !== undefined && { afterEntryId }),
    });
  const invite = (playlistId: string, userId: string) =>
    pool.query(
      "INSERT INTO playlist_invitations (playlist_id, user_id) VALUES ($1, $2)",
      [playlistId, userId],
    );

  async function connectAs(user: TestUser): Promise<Socket> {
    const socket = connect(`${baseUrl}/live`, {
      auth: { token: user.token },
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", () => resolve());
      socket.on("connect_error", reject);
    });
    return socket;
  }
  const follow = (socket: Socket, playlistId: string): Promise<SubscribeAck> =>
    socket.emitWithAck("subscribe", { resource: "playlist", id: playlistId });
  const updatesOf = (socket: Socket) =>
    new Inbox<PlaylistSnapshot>(socket, "playlist:updated");
  const lostOf = (socket: Socket) => new Inbox<AccessLost>(socket, "event:access-lost");
  const versionOf = async (playlistId: string) =>
    Number(
      (await pool.query("SELECT version FROM playlists WHERE id = $1", [playlistId]))
        .rows[0].version,
    );
  const followersOf = async (playlistId: string) =>
    (await io.of("/live").in(`playlist:${playlistId}`).fetchSockets()).length;
  const order = (snapshot: PlaylistSnapshot) =>
    snapshot.tracks.map((t) => t.track.providerTrackId);

  describe("subscribe", () => {
    it("answers with the current ordered tracks and version", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      await addTrack(owner, playlistId, "a");
      await addTrack(owner, playlistId, "b");

      const ack = await follow(await connectAs(owner), playlistId);

      expect(ack.ok).toBe(true);
      if (!ack.ok) throw new Error("subscribe failed");
      const snapshot = ack.snapshot as PlaylistSnapshot;
      expect(snapshot).toMatchObject({ playlistId, version: 2 });
      expect(order(snapshot)).toEqual(["a", "b"]);
      expect(JSON.stringify(snapshot)).not.toContain("position");
    });

    it("works for an empty playlist (version 0)", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);

      expect(await follow(await connectAs(owner), playlistId)).toEqual({
        ok: true,
        snapshot: { playlistId, version: 0, tracks: [] },
      });
    });

    it("lets an invited user follow a private playlist, but answers a stranger NOT_FOUND like a missing one", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const stranger = await makeUser("stranger");
      const playlistId = await createPlaylist(owner, {
        name: "P",
        visibility: "private",
      });
      await invite(playlistId, guest.id);
      const strangerSocket = await connectAs(stranger);

      const asGuest = await follow(await connectAs(guest), playlistId);
      const hidden = await follow(strangerSocket, playlistId);
      const missing = await follow(strangerSocket, MISSING_UUID);

      expect(asGuest.ok).toBe(true);
      expect(hidden).toEqual({
        ok: false,
        error: { code: "NOT_FOUND", message: expect.any(String) },
      });
      expect(hidden).toEqual(missing);
      expect(await followersOf(playlistId)).toBe(1);
    });

    it("lets anyone who can see a public playlist follow it, even without the right to edit it", async () => {
      const owner = await makeUser("owner");
      const watcher = await makeUser("watcher");
      const playlistId = await createPlaylist(owner, {
        name: "P",
        editLicense: { type: "invited_only" },
      });

      expect((await follow(await connectAs(watcher), playlistId)).ok).toBe(true);
    });

    it("never lets a refused follower hear later edits", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const playlistId = await createPlaylist(owner, {
        name: "P",
        visibility: "private",
      });
      const socket = await connectAs(stranger);
      const inbox = updatesOf(socket);
      await follow(socket, playlistId);

      await addTrack(owner, playlistId, "a");

      await inbox.expectNoMoreThan(0);
    });

    it("does not mix events and playlists up, in either direction", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);
      const playlistId = await createPlaylist(owner);
      const socket = await connectAs(owner);

      const eventAsPlaylist = await follow(socket, eventId);
      const playlistAsEvent = await socket.emitWithAck("subscribe", {
        resource: "event",
        id: playlistId,
      });

      expect(eventAsPlaylist).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
      expect(playlistAsEvent).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
      expect(await followersOf(playlistId)).toBe(0);
      expect((await io.of("/live").in(`event:${eventId}`).fetchSockets()).length).toBe(0);
    });

    it(`counts events and playlists together towards the ${MAX_SUBSCRIPTIONS_PER_SOCKET}-subscription limit`, async () => {
      const owner = await makeUser("owner");
      const socket = await connectAs(owner);
      const playlists: string[] = [];
      for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_SOCKET; i++) {
        playlists.push(
          i % 2 === 0 ? await createPlaylist(owner) : await createEvent(owner),
        );
      }
      for (const [i, id] of playlists.entries()) {
        const ack = await socket.emitWithAck("subscribe", {
          resource: i % 2 === 0 ? "playlist" : "event",
          id,
        });
        expect(ack.ok).toBe(true);
      }
      const one_more = await createPlaylist(owner);

      expect(await follow(socket, one_more)).toMatchObject({
        ok: false,
        error: { code: "RATE_LIMITED" },
      });
    });

    it("stops the updates after unsubscribe, which is harmless when not subscribed", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      const socket = await connectAs(owner);
      const inbox = updatesOf(socket);
      await follow(socket, playlistId);

      expect(
        await socket.emitWithAck("unsubscribe", { resource: "playlist", id: playlistId }),
      ).toEqual({ ok: true });
      expect(
        await socket.emitWithAck("unsubscribe", { resource: "playlist", id: playlistId }),
      ).toEqual({ ok: true });
      await addTrack(owner, playlistId, "a");

      await inbox.expectNoMoreThan(0);
    });
  });

  describe("updates", () => {
    it("sends one shared snapshot to the followers after an addition, with the version of the edit", async () => {
      const owner = await makeUser("owner");
      const watcher = await makeUser("watcher");
      const playlistId = await createPlaylist(owner);
      const watcherSocket = await connectAs(watcher);
      const inbox = updatesOf(watcherSocket);
      await follow(watcherSocket, playlistId);

      await addTrack(owner, playlistId, "a");

      const [snapshot] = await inbox.waitFor(1);
      expect(snapshot).toMatchObject({ playlistId, version: 1 });
      expect(order(snapshot!)).toEqual(["a"]);
      expect(snapshot!.tracks[0]).toMatchObject({ addedBy: owner.id, track: song("a") });
      expect(JSON.stringify(snapshot)).not.toContain("position");
    });

    it("follows additions after an anchor, moves and removals, in order and version by version", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      const first = (await addTrack(owner, playlistId, "a")).body.tracks[0].id as string;
      await addTrack(owner, playlistId, "c");
      const watcher = await connectAs(owner);
      const inbox = updatesOf(watcher);
      await follow(watcher, playlistId);

      await addTrack(owner, playlistId, "b", first); // a b c
      const moved = (await inbox.waitFor(1))[0]!;
      const bId = moved.tracks[1]!.id;
      await rest("post", `/playlists/${playlistId}/tracks/${bId}/move`, owner).send({
        afterEntryId: null,
      }); // b a c
      await inbox.waitFor(2);
      await rest("delete", `/playlists/${playlistId}/tracks/${first}`, owner); // b c
      const all = await inbox.waitFor(3);

      expect(all.map(order)).toEqual([
        ["a", "b", "c"],
        ["b", "a", "c"],
        ["b", "c"],
      ]);
      expect(all.map((s) => s.version)).toEqual([3, 4, 5]);
    });

    it("reaches every follower, including two tabs of one user, and nobody else", async () => {
      const owner = await makeUser("owner");
      const watcher = await makeUser("watcher");
      const playlistId = await createPlaylist(owner);
      const otherPlaylist = await createPlaylist(owner);
      const eventId = await createEvent(owner);
      const tabA = await connectAs(watcher);
      const tabB = await connectAs(watcher);
      const elsewhere = await connectAs(watcher);
      const onAnEvent = await connectAs(watcher);
      const notFollowing = await connectAs(watcher);
      const [boxA, boxB, boxElsewhere, boxEvent, boxNone] = [
        tabA,
        tabB,
        elsewhere,
        onAnEvent,
        notFollowing,
      ].map(updatesOf);
      await follow(tabA, playlistId);
      await follow(tabB, playlistId);
      await follow(elsewhere, otherPlaylist);
      await onAnEvent.emitWithAck("subscribe", { resource: "event", id: eventId });

      await addTrack(owner, playlistId, "a");

      await boxA!.waitFor(1);
      await boxB!.waitFor(1);
      await boxElsewhere!.expectNoMoreThan(0);
      await boxEvent!.expectNoMoreThan(0);
      await boxNone!.expectNoMoreThan(0);
    });

    it("sends nothing for an edit that changed nothing", async () => {
      const owner = await makeUser("owner");
      const playlistId = await createPlaylist(owner);
      const [a, b] = [
        (await addTrack(owner, playlistId, "a")).body.tracks[0].id as string,
        (await addTrack(owner, playlistId, "b")).body.tracks[1].id as string,
      ];
      const socket = await connectAs(owner);
      const inbox = updatesOf(socket);
      await follow(socket, playlistId);

      await rest("post", `/playlists/${playlistId}/tracks/${a}/move`, owner).send({
        afterEntryId: null,
      }); // already first
      await rest("post", `/playlists/${playlistId}/tracks/${a}/move`, owner).send({
        afterEntryId: a,
      }); // after itself
      await rest("post", `/playlists/${playlistId}/tracks/${b}/move`, owner).send({
        afterEntryId: a,
      }); // already there
      await rest("delete", `/playlists/${playlistId}/tracks/${MISSING_UUID}`, owner); // not in the list

      await inbox.expectNoMoreThan(0);
    });

    it("never announces a refused edit", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const playlistId = await createPlaylist(owner, {
        name: "P",
        editLicense: { type: "invited_only" },
      });
      const socket = await connectAs(stranger);
      const inbox = updatesOf(socket);
      await follow(socket, playlistId);

      const refused = await addTrack(stranger, playlistId, "a");
      const badAnchor = await addTrack(owner, playlistId, "b", MISSING_UUID);

      expect(refused.status).toBe(403);
      expect(badAnchor.status).toBe(409);
      await inbox.expectNoMoreThan(0);
    });

    it("ends on the final list after a burst of simultaneous additions, with versions that only grow", async () => {
      const owner = await makeUser("owner");
      const adders = await Promise.all(
        Array.from({ length: 20 }, (_, i) => makeUser(`adder-${i}`)),
      );
      const playlistId = await createPlaylist(owner);
      const socket = await connectAs(owner);
      const inbox = updatesOf(socket);
      await follow(socket, playlistId);

      await Promise.all(adders.map((u, i) => addTrack(u, playlistId, `t${i}`)));

      const finalVersion = await versionOf(playlistId);
      for (
        let i = 0;
        i < 40 && (inbox.messages.at(-1)?.version ?? 0) < finalVersion;
        i++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const versions = inbox.messages.map((m) => m.version);
      expect(finalVersion).toBe(20);
      expect(versions.at(-1)).toBe(finalVersion);
      expect(inbox.messages.at(-1)!.tracks).toHaveLength(20);
      expect(versions).toEqual([...versions].sort((a, b) => a - b));
      expect(new Set(versions).size).toBe(versions.length);
      expect(versions.length).toBeLessThanOrEqual(20);
    });
  });

  describe("losing access", () => {
    async function privatePlaylistWithGuests() {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const friend = await makeUser("friend");
      const playlistId = await createPlaylist(owner, {
        name: "P",
        visibility: "private",
      });
      await invite(playlistId, guest.id);
      await invite(playlistId, friend.id);
      const sockets = {
        owner: await connectAs(owner),
        guest: await connectAs(guest),
        friend: await connectAs(friend),
      };
      for (const socket of Object.values(sockets)) await follow(socket, playlistId);
      return { owner, guest, friend, playlistId, sockets };
    }

    it("removes a user whose invitation is withdrawn, and tells them why", async () => {
      const { owner, guest, playlistId, sockets } = await privatePlaylistWithGuests();
      const lost = lostOf(sockets.guest);
      const guestUpdates = updatesOf(sockets.guest);
      const friendUpdates = updatesOf(sockets.friend);

      await rest("delete", `/playlists/${playlistId}/invitations/${guest.id}`, owner);

      expect(await lost.waitFor(1)).toEqual([
        { resource: "playlist", id: playlistId, reason: "no_access" },
      ]);
      await addTrack(owner, playlistId, "a");
      await friendUpdates.waitFor(1);
      await guestUpdates.expectNoMoreThan(0);
      expect(await followersOf(playlistId)).toBe(2);
    });

    it("cannot follow again after losing access", async () => {
      const { owner, guest, playlistId, sockets } = await privatePlaylistWithGuests();
      await rest("delete", `/playlists/${playlistId}/invitations/${guest.id}`, owner);
      await lostOf(sockets.guest).waitFor(1);

      expect(await follow(sockets.guest, playlistId)).toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
    });

    it("removes the non-invited when a playlist becomes private, and keeps the owner and the invited", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const stranger = await makeUser("stranger");
      const playlistId = await createPlaylist(owner);
      await invite(playlistId, guest.id);
      const [ownerSocket, guestSocket, strangerSocket] = [
        await connectAs(owner),
        await connectAs(guest),
        await connectAs(stranger),
      ];
      for (const socket of [ownerSocket, guestSocket, strangerSocket])
        await follow(socket, playlistId);
      const [strangerLost, guestLost, ownerLost] = [
        lostOf(strangerSocket),
        lostOf(guestSocket),
        lostOf(ownerSocket),
      ];

      await rest("patch", `/playlists/${playlistId}`, owner).send({
        visibility: "private",
      });

      expect(await strangerLost.waitFor(1)).toEqual([
        { resource: "playlist", id: playlistId, reason: "no_access" },
      ]);
      await guestLost!.expectNoMoreThan(0);
      await ownerLost!.expectNoMoreThan(0);
      expect(await followersOf(playlistId)).toBe(2);
    });

    it("removes nobody when a playlist becomes public, or when only its name or license change", async () => {
      const { owner, playlistId } = await privatePlaylistWithGuests();
      const before = await followersOf(playlistId);

      await rest("patch", `/playlists/${playlistId}`, owner).send({ name: "Renamed" });
      await rest("patch", `/playlists/${playlistId}`, owner).send({
        editLicense: { type: "invited_only" },
      });
      await rest("patch", `/playlists/${playlistId}`, owner).send({
        visibility: "public",
      });
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(await followersOf(playlistId)).toBe(before);
    });

    it("does not remove anyone when an invitation to a PUBLIC playlist is withdrawn: they can still see it", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const playlistId = await createPlaylist(owner);
      await invite(playlistId, guest.id);
      const socket = await connectAs(guest);
      await follow(socket, playlistId);
      const lost = lostOf(socket);

      await rest("delete", `/playlists/${playlistId}/invitations/${guest.id}`, owner);

      await lost.expectNoMoreThan(0);
      expect(await followersOf(playlistId)).toBe(1);
    });

    it("tells everybody when the playlist is deleted and removes them all", async () => {
      const { owner, playlistId, sockets } = await privatePlaylistWithGuests();
      const inboxes = Object.values(sockets).map(lostOf);

      expect((await rest("delete", `/playlists/${playlistId}`, owner)).status).toBe(204);

      for (const inbox of inboxes) {
        expect(await inbox.waitFor(1)).toEqual([
          { resource: "playlist", id: playlistId, reason: "deleted" },
        ]);
      }
      for (let i = 0; i < 20 && (await followersOf(playlistId)) > 0; i++)
        await new Promise((r) => setTimeout(r, 50));
      expect(await followersOf(playlistId)).toBe(0);
    });

    it("removes the socket from THAT playlist only: its other subscriptions, events included, continue", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const secret = await createPlaylist(owner, {
        name: "Secret",
        visibility: "private",
      });
      const open = await createPlaylist(owner, { name: "Open" });
      const eventId = await createEvent(owner);
      await invite(secret, guest.id);
      const socket = await connectAs(guest);
      const updates = updatesOf(socket);
      const queueUpdates = new Inbox<{ eventId: string }>(socket, "event:queue");
      await follow(socket, secret);
      await follow(socket, open);
      await socket.emitWithAck("subscribe", { resource: "event", id: eventId });

      await rest("delete", `/playlists/${secret}/invitations/${guest.id}`, owner);
      await lostOf(socket).waitFor(1);
      await addTrack(owner, secret, "x"); // not heard any more
      await addTrack(owner, open, "y"); // still heard
      await rest("post", `/events/${eventId}/tracks`, owner).send({
        providerTrackId: "e1",
      }); // the event too

      const [only] = await updates.waitFor(1);
      expect(only!.playlistId).toBe(open);
      await updates.expectNoMoreThan(1);
      await queueUpdates.waitFor(1);
    });
  });
});
