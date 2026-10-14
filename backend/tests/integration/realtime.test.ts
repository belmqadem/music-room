import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AccessLost, QueueSnapshot, SubscribeAck, Track } from "@music-room/shared";
import pg from "pg";
import pino from "pino";
import { io as connect, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";
import { signAccessToken } from "../../src/modules/auth/access-token.js";
import type { CatalogProvider } from "../../src/modules/track-vote/catalog.js";
import { createRealtime } from "../../src/sockets/index.js";
import { MAX_SUBSCRIPTIONS_PER_SOCKET } from "../../src/sockets/authenticated-namespace.js";
import { Inbox } from "../helpers/socket-inbox.js";

// Real-time updates with a REAL Socket.io server and client over a real Postgres
// (set TEST_DATABASE_URL; see `make test-integration`). The catalog is a fake.
//
// Rules under test (ADR-019):
//  - subscribing needs the same right to SEE the event as REST, and a hidden event looks missing;
//  - the acknowledgement brings the current queue with MY votedByMe; broadcasts are one shared
//    snapshot without votedByMe, sent after each real change and only to subscribers;
//  - losing access (invitation removed, event made private or deleted) removes the socket
//    from that event's channel, and only from that one.
const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(32);
const NAME_PREFIX = "rt-test-";
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

describe.skipIf(!databaseUrl)("real-time queue updates", () => {
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
  const createEvent = async (
    owner: TestUser,
    body: object = { name: "E" },
  ): Promise<string> => (await rest("post", "/events", owner).send(body)).body.id;
  const suggest = async (
    user: TestUser,
    eventId: string,
    providerTrackId: string,
  ): Promise<string> =>
    (await rest("post", `/events/${eventId}/tracks`, user).send({ providerTrackId })).body
      .id;
  const invite = (eventId: string, userId: string) =>
    pool.query("INSERT INTO event_invitations (event_id, user_id) VALUES ($1, $2)", [
      eventId,
      userId,
    ]);

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
  const subscribe = (socket: Socket, eventId: string): Promise<SubscribeAck> =>
    socket.emitWithAck("subscribe", { resource: "event", id: eventId });
  const queueInbox = (socket: Socket) => new Inbox<QueueSnapshot>(socket, "event:queue");
  const lostInbox = (socket: Socket) =>
    new Inbox<AccessLost>(socket, "event:access-lost");
  const versionOf = async (eventId: string) =>
    Number(
      (await pool.query("SELECT queue_version FROM events WHERE id = $1", [eventId]))
        .rows[0].queue_version,
    );
  const subscribersOf = async (eventId: string) =>
    (await io.of("/live").in(`event:${eventId}`).fetchSockets()).length;

  describe("subscribe", () => {
    it("answers with the current queue and brings the caller's own votedByMe", async () => {
      const owner = await makeUser("owner");
      const watcher = await makeUser("watcher");
      const eventId = await createEvent(owner);
      await suggest(owner, eventId, "1");

      const ownerAck = await subscribe(await connectAs(owner), eventId);
      const watcherAck = await subscribe(await connectAs(watcher), eventId);

      expect(ownerAck).toMatchObject({ ok: true, snapshot: { eventId, version: 1 } });
      if (!ownerAck.ok || !watcherAck.ok) throw new Error("subscribe failed");
      expect(ownerAck.snapshot.tracks[0]).toMatchObject({
        voteCount: 1,
        votedByMe: true,
      });
      expect(watcherAck.snapshot.tracks[0]).toMatchObject({
        voteCount: 1,
        votedByMe: false,
      });
    });

    it("works for an event with no tracks yet (version 0)", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);

      expect(await subscribe(await connectAs(owner), eventId)).toEqual({
        ok: true,
        snapshot: { eventId, version: 0, tracks: [] },
      });
    });

    it("lets an invited user follow a private event, but answers a stranger NOT_FOUND like a missing event", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const stranger = await makeUser("stranger");
      const eventId = await createEvent(owner, { name: "E", visibility: "private" });
      await invite(eventId, guest.id);
      const strangerSocket = await connectAs(stranger);

      const asGuest = await subscribe(await connectAs(guest), eventId);
      const hidden = await subscribe(strangerSocket, eventId);
      const missing = await subscribe(strangerSocket, MISSING_UUID);

      expect(asGuest.ok).toBe(true);
      expect(hidden).toEqual({
        ok: false,
        error: { code: "NOT_FOUND", message: expect.any(String) },
      });
      expect(hidden).toEqual(missing);
      expect(await subscribersOf(eventId)).toBe(1); // only the guest is in the room
    });

    it("never lets a refused subscriber hear later updates", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const eventId = await createEvent(owner, { name: "E", visibility: "private" });
      const strangerSocket = await connectAs(stranger);
      const inbox = queueInbox(strangerSocket);
      await subscribe(strangerSocket, eventId);

      await suggest(owner, eventId, "1");

      await inbox.expectNoMoreThan(0);
    });

    it.each([
      ["nothing", undefined],
      ["null", null],
      ["a string", "event"],
      ["an empty object", {}],
      ["no id", { resource: "event" }],
      ["no resource", { id: MISSING_UUID }],
      ["an id that is not a UUID", { resource: "event", id: "42" }],
      ["an unknown resource", { resource: "user", id: MISSING_UUID }],
    ])("answers VALIDATION_ERROR for %s", async (_label, payload) => {
      const owner = await makeUser("owner");
      const socket = await connectAs(owner);

      const ack = await socket.emitWithAck("subscribe", payload);

      expect(ack).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    });

    it("does not mix the two kinds up: an event id is not a playlist, and the other way round", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner); // a REAL, visible event
      const socket = await connectAs(owner);

      const asPlaylist = await socket.emitWithAck("subscribe", {
        resource: "playlist",
        id: eventId,
      });

      expect(asPlaylist).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
      expect(await subscribersOf(eventId)).toBe(0);
    });

    it("survives a subscribe sent without an acknowledgement callback", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);
      const socket = await connectAs(owner);

      socket.emit("subscribe", { resource: "event", id: eventId });
      socket.emit("subscribe", "garbage");

      expect((await subscribe(socket, eventId)).ok).toBe(true);
    });

    it("can be repeated: still one copy of each update", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);
      const socket = await connectAs(owner);
      const inbox = queueInbox(socket);
      await subscribe(socket, eventId);
      await subscribe(socket, eventId);

      await suggest(owner, eventId, "1");

      await inbox.waitFor(1);
      await inbox.expectNoMoreThan(1);
    });

    it(`allows ${MAX_SUBSCRIPTIONS_PER_SOCKET} events per socket, then answers RATE_LIMITED`, async () => {
      const owner = await makeUser("owner");
      const socket = await connectAs(owner);
      const eventIds: string[] = [];
      for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_SOCKET + 1; i++)
        eventIds.push(await createEvent(owner));
      for (const id of eventIds.slice(0, MAX_SUBSCRIPTIONS_PER_SOCKET)) {
        expect((await subscribe(socket, id)).ok).toBe(true);
      }
      const extra = eventIds[MAX_SUBSCRIPTIONS_PER_SOCKET]!;

      const refused = await subscribe(socket, extra);
      const again = await subscribe(socket, eventIds[0]!); // one it already follows is fine
      await socket.emitWithAck("unsubscribe", { resource: "event", id: eventIds[1] });
      const afterFreeing = await subscribe(socket, extra);

      expect(refused).toMatchObject({ ok: false, error: { code: "RATE_LIMITED" } });
      expect(again.ok).toBe(true);
      expect(afterFreeing.ok).toBe(true);
    });
  });

  describe("unsubscribe", () => {
    it("stops the updates, and is harmless when not subscribed", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);
      const socket = await connectAs(owner);
      const inbox = queueInbox(socket);
      await subscribe(socket, eventId);

      expect(
        await socket.emitWithAck("unsubscribe", { resource: "event", id: eventId }),
      ).toEqual({ ok: true });
      expect(
        await socket.emitWithAck("unsubscribe", { resource: "event", id: eventId }),
      ).toEqual({ ok: true });
      await suggest(owner, eventId, "1");

      await inbox.expectNoMoreThan(0);
      expect(await socket.emitWithAck("unsubscribe", { nope: 1 })).toMatchObject({
        ok: false,
        error: { code: "VALIDATION_ERROR" },
      });
    });

    it("leaves the room when the socket disconnects", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);
      const socket = await connectAs(owner);
      await subscribe(socket, eventId);
      expect(await subscribersOf(eventId)).toBe(1);

      socket.close();
      for (let i = 0; i < 20 && (await subscribersOf(eventId)) > 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(await subscribersOf(eventId)).toBe(0);
    });
  });

  describe("updates", () => {
    it("sends one shared snapshot to subscribers after a suggestion, with the version of the change", async () => {
      const owner = await makeUser("owner");
      const watcher = await makeUser("watcher");
      const eventId = await createEvent(owner);
      const watcherSocket = await connectAs(watcher);
      const inbox = queueInbox(watcherSocket);
      await subscribe(watcherSocket, eventId);

      const trackId = await suggest(owner, eventId, "1");

      const [snapshot] = await inbox.waitFor(1);
      expect(snapshot).toMatchObject({ eventId, version: 1 });
      expect(snapshot!.tracks).toHaveLength(1);
      expect(snapshot!.tracks[0]).toMatchObject({
        id: trackId,
        voteCount: 1,
        status: "queued",
        track: song("1"),
      });
      expect(JSON.stringify(snapshot)).not.toContain("votedByMe"); // personal data is not broadcast
    });

    it("reaches every subscriber, including two tabs of one user, and nobody else", async () => {
      const owner = await makeUser("owner");
      const watcher = await makeUser("watcher");
      const outsider = await makeUser("outsider");
      const eventId = await createEvent(owner);
      const otherEvent = await createEvent(owner);
      const tabA = await connectAs(watcher);
      const tabB = await connectAs(watcher);
      const elsewhere = await connectAs(outsider);
      const notSubscribed = await connectAs(outsider);
      const [boxA, boxB, boxElsewhere, boxNone] = [
        tabA,
        tabB,
        elsewhere,
        notSubscribed,
      ].map(queueInbox);
      await subscribe(tabA, eventId);
      await subscribe(tabB, eventId);
      await subscribe(elsewhere, otherEvent);

      await suggest(owner, eventId, "1");

      await boxA!.waitFor(1);
      await boxB!.waitFor(1);
      await boxElsewhere!.expectNoMoreThan(0);
      await boxNone!.expectNoMoreThan(0);
    });

    it("follows votes, withdrawals and advancing, with the playing track first", async () => {
      const owner = await makeUser("owner");
      const voter = await makeUser("voter");
      const eventId = await createEvent(owner);
      const first = await suggest(owner, eventId, "1");
      await suggest(owner, eventId, "2");
      const socket = await connectAs(voter);
      const inbox = queueInbox(socket);
      await subscribe(socket, eventId);

      await rest("put", `/events/${eventId}/tracks/${first}/vote`, voter);
      const afterVote = (await inbox.waitFor(1))[0]!;
      await rest("delete", `/events/${eventId}/tracks/${first}/vote`, voter);
      const afterWithdraw = (await inbox.waitFor(2))[1]!;
      await rest("post", `/events/${eventId}/queue/advance`, owner).send({
        currentTrackId: null,
      });
      const afterAdvance = (await inbox.waitFor(3))[2]!;

      expect(afterVote.tracks.find((t) => t.id === first)?.voteCount).toBe(2);
      expect(afterWithdraw.tracks.find((t) => t.id === first)?.voteCount).toBe(1);
      expect(afterAdvance.tracks[0]).toMatchObject({ id: first, status: "playing" });
      expect([afterVote.version, afterWithdraw.version, afterAdvance.version]).toEqual([
        3, 4, 5,
      ]);
    });

    it("sends nothing for a change that changed nothing (a repeated vote)", async () => {
      const owner = await makeUser("owner");
      const voter = await makeUser("voter");
      const eventId = await createEvent(owner);
      const trackId = await suggest(owner, eventId, "1");
      await rest("put", `/events/${eventId}/tracks/${trackId}/vote`, voter);
      const socket = await connectAs(voter);
      const inbox = queueInbox(socket);
      await subscribe(socket, eventId);

      await rest("put", `/events/${eventId}/tracks/${trackId}/vote`, voter);
      await rest("delete", `/events/${eventId}/tracks/${MISSING_UUID}/vote`, voter); // refused

      await inbox.expectNoMoreThan(0);
    });

    it("never announces a refused request", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const eventId = await createEvent(owner, {
        name: "E",
        voteLicense: { type: "invited_only" },
      });
      const socket = await connectAs(stranger);
      const inbox = queueInbox(socket);
      await subscribe(socket, eventId);

      const refused = await rest("post", `/events/${eventId}/tracks`, stranger).send({
        providerTrackId: "1",
      });

      expect(refused.status).toBe(403);
      await inbox.expectNoMoreThan(0);
    });

    it("ends on the final state after a burst of simultaneous votes, with versions that only grow", async () => {
      const owner = await makeUser("owner");
      const voters = await Promise.all(
        Array.from({ length: 20 }, (_, i) => makeUser(`voter-${i}`)),
      );
      const eventId = await createEvent(owner);
      const trackId = await suggest(owner, eventId, "1");
      const socket = await connectAs(owner);
      const inbox = queueInbox(socket);
      await subscribe(socket, eventId);

      await Promise.all(
        voters.map((v) => rest("put", `/events/${eventId}/tracks/${trackId}/vote`, v)),
      );

      const finalVersion = await versionOf(eventId);
      for (
        let i = 0;
        i < 40 && (inbox.messages.at(-1)?.version ?? 0) < finalVersion;
        i++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const versions = inbox.messages.map((m) => m.version);
      expect(versions.at(-1)).toBe(finalVersion);
      expect(inbox.messages.at(-1)!.tracks[0]!.voteCount).toBe(21);
      expect(versions).toEqual([...versions].sort((a, b) => a - b)); // never goes backwards
      expect(new Set(versions).size).toBe(versions.length);
      expect(versions.length).toBeLessThanOrEqual(20);
    });
  });

  describe("losing access", () => {
    async function privateEventWithGuest() {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const friend = await makeUser("friend");
      const eventId = await createEvent(owner, { name: "E", visibility: "private" });
      await invite(eventId, guest.id);
      await invite(eventId, friend.id);
      const sockets = {
        owner: await connectAs(owner),
        guest: await connectAs(guest),
        friend: await connectAs(friend),
      };
      for (const socket of Object.values(sockets)) await subscribe(socket, eventId);
      return { owner, guest, friend, eventId, sockets };
    }

    it("removes a user whose invitation is withdrawn, and tells them why", async () => {
      const { owner, guest, eventId, sockets } = await privateEventWithGuest();
      const lost = lostInbox(sockets.guest);
      const guestUpdates = queueInbox(sockets.guest);
      const friendUpdates = queueInbox(sockets.friend);

      await rest("delete", `/events/${eventId}/invitations/${guest.id}`, owner);

      expect(await lost.waitFor(1)).toEqual([
        { resource: "event", id: eventId, reason: "no_access" },
      ]);
      await suggest(owner, eventId, "1");
      await friendUpdates.waitFor(1); // the others carry on
      await guestUpdates.expectNoMoreThan(0); // the removed guest hears nothing
      expect(await subscribersOf(eventId)).toBe(2);
    });

    it("cannot subscribe again after losing access", async () => {
      const { owner, guest, eventId, sockets } = await privateEventWithGuest();
      await rest("delete", `/events/${eventId}/invitations/${guest.id}`, owner);
      await lostInbox(sockets.guest).waitFor(1);

      expect(await subscribe(sockets.guest, eventId)).toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
    });

    it("removes the non-invited when an event becomes private, and keeps the owner and the invited", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const stranger = await makeUser("stranger");
      const eventId = await createEvent(owner);
      await invite(eventId, guest.id);
      const [ownerSocket, guestSocket, strangerSocket] = [
        await connectAs(owner),
        await connectAs(guest),
        await connectAs(stranger),
      ];
      for (const socket of [ownerSocket, guestSocket, strangerSocket])
        await subscribe(socket, eventId);
      const strangerLost = lostInbox(strangerSocket);
      const guestLost = lostInbox(guestSocket);
      const ownerLost = lostInbox(ownerSocket);

      await rest("patch", `/events/${eventId}`, owner).send({ visibility: "private" });

      expect(await strangerLost.waitFor(1)).toEqual([
        { resource: "event", id: eventId, reason: "no_access" },
      ]);
      await guestLost.expectNoMoreThan(0);
      await ownerLost.expectNoMoreThan(0);
      expect(await subscribersOf(eventId)).toBe(2);
    });

    it("removes nobody when an event becomes public, or when only its name or license change", async () => {
      const { owner, eventId } = await privateEventWithGuest();
      const before = await subscribersOf(eventId);

      await rest("patch", `/events/${eventId}`, owner).send({ name: "Renamed" });
      await rest("patch", `/events/${eventId}`, owner).send({
        voteLicense: { type: "invited_only" },
      });
      await rest("patch", `/events/${eventId}`, owner).send({ visibility: "public" });
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(await subscribersOf(eventId)).toBe(before);
    });

    it("does not remove anyone when an invitation to a PUBLIC event is withdrawn: they can still see it", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const eventId = await createEvent(owner);
      await invite(eventId, guest.id);
      const socket = await connectAs(guest);
      await subscribe(socket, eventId);
      const lost = lostInbox(socket);

      await rest("delete", `/events/${eventId}/invitations/${guest.id}`, owner);

      await lost.expectNoMoreThan(0);
      expect(await subscribersOf(eventId)).toBe(1);
    });

    it("tells everybody when the event is deleted and removes them all", async () => {
      const { owner, eventId, sockets } = await privateEventWithGuest();
      const inboxes = Object.values(sockets).map(lostInbox);

      expect((await rest("delete", `/events/${eventId}`, owner)).status).toBe(204);

      for (const inbox of inboxes) {
        expect(await inbox.waitFor(1)).toEqual([
          { resource: "event", id: eventId, reason: "deleted" },
        ]);
      }
      for (let i = 0; i < 20 && (await subscribersOf(eventId)) > 0; i++)
        await new Promise((r) => setTimeout(r, 50));
      expect(await subscribersOf(eventId)).toBe(0);
    });

    it("removes the socket from THAT event only: its other subscriptions continue", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const secret = await createEvent(owner, { name: "Secret", visibility: "private" });
      const open = await createEvent(owner, { name: "Open" });
      await invite(secret, guest.id);
      const socket = await connectAs(guest);
      const updates = queueInbox(socket);
      await subscribe(socket, secret);
      await subscribe(socket, open);

      await rest("delete", `/events/${secret}/invitations/${guest.id}`, owner);
      await lostInbox(socket).waitFor(1);
      await suggest(owner, secret, "1"); // not heard any more
      await suggest(owner, open, "2"); // still heard

      const [only] = await updates.waitFor(1);
      expect(only!.eventId).toBe(open);
      await updates.expectNoMoreThan(1);
    });
  });
});
