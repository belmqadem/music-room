import { createServer, type Server } from "node:http";
import type { Express } from "express";
import type { Track } from "@music-room/shared";
import pg from "pg";
import pino from "pino";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";
import { signAccessToken } from "../../src/modules/auth/access-token.js";
import type { CatalogProvider } from "../../src/modules/track-vote/catalog.js";

// POST /events/{id}/queue/advance against a real, migrated Postgres (set TEST_DATABASE_URL;
// see `make test-integration`). The catalog is a fake.
//
// Rules under test (ADR-016, ADR-018):
//  - only the OWNER advances the queue, and the SERVER picks the next track
//    (most votes, then oldest suggestion, then id);
//  - the request names the track the app believes is playing: if that is wrong
//    (a double tap, a second device) the answer is 409 QUEUE_CHANGED and NOTHING moves;
//  - at most one track is playing, and a playing/played track cannot be voted for.
const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(32);
const NAME_PREFIX = "advance-test-";
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

interface TestUser {
  id: string;
  token: string;
}
interface QueueBody {
  eventId: string;
  version: number;
  tracks: {
    id: string;
    status: string;
    voteCount: number;
    track: { providerTrackId: string };
  }[];
}

const song = (id: string): Track => ({
  providerTrackId: id,
  title: `Song ${id}`,
  artist: "Artist",
  durationSeconds: 200,
  coverUrl: null,
});

describe.skipIf(!databaseUrl)("advancing the queue", () => {
  let pool: pg.Pool;
  let app: Express;
  let server: Server;

  const catalog: CatalogProvider = {
    search: () => Promise.resolve([]),
    getTrack: (id) => Promise.resolve(song(id)),
  };

  beforeAll(() => {
    pool = createPostgresPool(databaseUrl!);
    app = createApp({
      pool,
      jwtSecret: SECRET,
      logger: pino({ level: "silent" }),
      catalog,
      suggestLimit: { windowMs: 60_000, limit: 100_000 },
    });
    server = createServer(app).listen(0);
  });
  afterEach(async () => {
    await pool.query("DELETE FROM users WHERE display_name LIKE $1", [`${NAME_PREFIX}%`]);
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });

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
    method: "get" | "post" | "put" | "delete",
    path: string,
    user?: TestUser,
  ) => {
    const req = request(server)[method](`/api/v1${path}`);
    return user ? req.set("Authorization", `Bearer ${user.token}`) : req;
  };
  const createEvent = async (
    owner: TestUser,
    body: object = { name: "E" },
  ): Promise<string> => (await call("post", "/events", owner).send(body)).body.id;
  const suggest = async (user: TestUser, eventId: string, providerTrackId: string) =>
    (await call("post", `/events/${eventId}/tracks`, user).send({ providerTrackId })).body
      .id as string;
  const vote = (user: TestUser, eventId: string, trackId: string) =>
    call("put", `/events/${eventId}/tracks/${trackId}/vote`, user);
  const advance = (user: TestUser, eventId: string, currentTrackId: string | null) =>
    call("post", `/events/${eventId}/queue/advance`, user).send({ currentTrackId });
  const queueOf = async (user: TestUser, eventId: string) =>
    (await call("get", `/events/${eventId}/tracks`, user)).body as QueueBody;
  const versionOf = async (eventId: string) =>
    Number(
      (await pool.query("SELECT queue_version FROM events WHERE id = $1", [eventId]))
        .rows[0].queue_version,
    );
  const idsOf = (queue: QueueBody) => queue.tracks.map((t) => t.track.providerTrackId);
  const statusCounts = async (eventId: string) =>
    Object.fromEntries(
      (
        await pool.query(
          "SELECT status, count(*) FROM event_tracks WHERE event_id = $1 GROUP BY status",
          [eventId],
        )
      ).rows.map((r) => [r.status, Number(r.count)]),
    );

  /** An event with tracks "a", "b", "c": b has 3 votes, c has 2, a has 1 (so the order is b, c, a). */
  async function eventWithRankedTracks() {
    const owner = await makeUser("owner");
    const voters = await Promise.all(
      Array.from({ length: 3 }, (_, i) => makeUser(`voter-${i}`)),
    );
    const eventId = await createEvent(owner);
    const a = await suggest(owner, eventId, "a");
    const b = await suggest(owner, eventId, "b");
    const c = await suggest(owner, eventId, "c");
    for (const v of voters.slice(0, 2)) await vote(v, eventId, b);
    await vote(voters[0]!, eventId, c);
    return { owner, voters, eventId, a, b, c };
  }

  describe("authentication and validation", () => {
    it("requires a token", async () => {
      const response = await call("post", `/events/${MISSING_UUID}/queue/advance`).send({
        currentTrackId: null,
      });

      expect(response.status).toBe(401);
    });

    it.each([
      ["no body", undefined],
      ["an empty body", {}],
      ["a current track that is not a UUID", { currentTrackId: "42" }],
      ["a number", { currentTrackId: 5 }],
      [
        "a next track chosen by the client",
        { currentTrackId: null, nextTrackId: MISSING_UUID },
      ],
      ["an extra field", { currentTrackId: null, skip: true }],
    ])("answers 400 for %s", async (_label, body) => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);

      const req = call("post", `/events/${eventId}/queue/advance`, owner);
      const response = await (body === undefined ? req : req.send(body));

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("answers 400 for an event id that is not a UUID", async () => {
      const owner = await makeUser("owner");

      expect((await advance(owner, "42", null)).status).toBe(400);
    });
  });

  describe("who may advance", () => {
    it("lets the owner, on any license and without a location", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner, {
        name: "E",
        voteLicense: {
          type: "location_time",
          latitude: 48.8566,
          longitude: 2.3522,
          radiusMeters: 500,
          startsAt: "2020-01-01T00:00:00Z",
          endsAt: "2020-01-01T01:00:00Z", // long over
        },
      });
      await pool.query(
        "INSERT INTO event_tracks (event_id, provider_track_id, title, artist, duration_seconds, suggested_by, vote_count) VALUES ($1, '1', 't', 'a', 1, $2, 1)",
        [eventId, owner.id],
      );

      expect((await advance(owner, eventId, null)).status).toBe(200);
    });

    it("refuses someone who can see the event but is not its owner, with 403", async () => {
      const { eventId, voters } = await eventWithRankedTracks();

      const response = await advance(voters[0]!, eventId, null);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(await statusCounts(eventId)).toEqual({ queued: 3 });
    });

    it("refuses an invited user too: being invited is not owning", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const eventId = await createEvent(owner, { name: "E", visibility: "private" });
      await suggest(owner, eventId, "a");
      await pool.query(
        "INSERT INTO event_invitations (event_id, user_id) VALUES ($1, $2)",
        [eventId, guest.id],
      );

      expect((await advance(guest, eventId, null)).status).toBe(403);
      expect(await statusCounts(eventId)).toEqual({ queued: 1 });
    });

    it("turns a non-owner away at once, without waiting for the event's lock", async () => {
      const { eventId, voters } = await eventWithRankedTracks();
      const holder = await pool.connect();
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
        const answered = advance(voters[0]!, eventId, null).then((response) => response);
        const outcome = await Promise.race([
          answered,
          new Promise<"still waiting">((resolve) =>
            setTimeout(() => resolve("still waiting"), 700),
          ),
        ]);
        await holder.query("COMMIT");
        await answered;

        expect(outcome).not.toBe("still waiting");
        expect((outcome as request.Response).status).toBe(403);
      } finally {
        await holder.query("ROLLBACK").catch(() => undefined); // never hand a connection back inside an open transaction
        holder.release();
      }
    });

    it("answers 404 for a hidden private event and for a missing one", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const eventId = await createEvent(owner, { name: "E", visibility: "private" });

      const hidden = await advance(stranger, eventId, null);
      const missing = await advance(stranger, MISSING_UUID, null);

      expect(hidden.status).toBe(404);
      expect(hidden.body).toEqual(missing.body);
    });
  });

  describe("moving through the queue", () => {
    it("starts the best track first: most votes, not the oldest", async () => {
      const { owner, eventId, b } = await eventWithRankedTracks();
      const versionBefore = await versionOf(eventId);

      const response = await advance(owner, eventId, null);

      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      const queue = response.body as QueueBody;
      expect(queue.eventId).toBe(eventId);
      expect(idsOf(queue)).toEqual(["b", "c", "a"]); // playing first, then ranked
      expect(queue.tracks[0]).toMatchObject({ id: b, status: "playing" });
      expect(queue.tracks.slice(1).every((t) => t.status === "queued")).toBe(true);
      expect(queue.version).toBe(versionBefore + 1);
    });

    it("finishes the playing track and starts the next best one", async () => {
      const { owner, eventId, a, b, c } = await eventWithRankedTracks();
      await advance(owner, eventId, null); // b plays

      const response = await advance(owner, eventId, b);

      expect(response.status).toBe(200);
      const queue = response.body as QueueBody;
      expect(idsOf(queue)).toEqual(["c", "a"]); // b is history now, c plays
      expect(queue.tracks[0]).toMatchObject({ id: c, status: "playing" });
      const played = (
        await pool.query(
          "SELECT status, started_at, ended_at FROM event_tracks WHERE id = $1",
          [b],
        )
      ).rows[0];
      expect(played.status).toBe("played");
      expect(played.ended_at.getTime()).toBeGreaterThanOrEqual(
        played.started_at.getTime(),
      );
      expect(await statusCounts(eventId)).toEqual({ played: 1, playing: 1, queued: 1 });
      expect(a).toBeDefined();
    });

    it("breaks a tie by the oldest suggestion", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);
      for (const id of ["first", "second", "third"]) {
        await pool.query(
          `INSERT INTO event_tracks (event_id, provider_track_id, title, artist, duration_seconds, suggested_by, vote_count, suggested_at)
           VALUES ($1, $2, 't', 'a', 1, $3, 5, $4)`,
          [
            eventId,
            id,
            owner.id,
            id === "first"
              ? "2026-10-12T10:00:00Z"
              : id === "second"
                ? "2026-10-12T11:00:00Z"
                : "2026-10-12T12:00:00Z",
          ],
        );
      }

      const queue = (await advance(owner, eventId, null)).body as QueueBody;

      expect(queue.tracks[0]!.track.providerTrackId).toBe("first");
    });

    it("plays the whole queue in order, then ends with nothing playing", async () => {
      const { owner, eventId, b } = await eventWithRankedTracks();
      const order: string[] = [];
      let current: string | null = null;
      for (let step = 0; step < 4; step++) {
        const queue = (await advance(owner, eventId, current)).body as QueueBody;
        const playing = queue.tracks.find((t) => t.status === "playing");
        if (playing) order.push(playing.track.providerTrackId);
        current = playing?.id ?? null;
      }

      expect(order).toEqual(["b", "c", "a"]);
      expect(current).toBeNull();
      expect(await statusCounts(eventId)).toEqual({ played: 3 });
      expect((await queueOf(owner, eventId)).tracks).toEqual([]);
      expect(b).toBeDefined();
    });

    it("does nothing, and does not raise the version, when nothing is playing and nothing is queued", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);

      const response = await advance(owner, eventId, null);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ eventId, version: 0, tracks: [] });
    });

    it("lets a played song be suggested again", async () => {
      const { owner, eventId, b } = await eventWithRankedTracks();
      await advance(owner, eventId, null);
      await advance(owner, eventId, b);

      const again = await call("post", `/events/${eventId}/tracks`, owner).send({
        providerTrackId: "b",
      });

      expect(again.status).toBe(201);
    });

    it("closes voting on the track that starts to play, and on the one that finished", async () => {
      const { owner, voters, eventId, b } = await eventWithRankedTracks();
      await advance(owner, eventId, null);
      expect((await vote(voters[2]!, eventId, b)).body.error.code).toBe(
        "TRACK_NOT_VOTABLE",
      );
      await advance(owner, eventId, b);

      expect((await vote(voters[2]!, eventId, b)).body.error.code).toBe(
        "TRACK_NOT_VOTABLE",
      );
    });
  });

  describe("409 QUEUE_CHANGED: nothing moves when the app is out of date", () => {
    it.each([
      ["a track that is not playing", "queued"],
      ["a track id that does not exist", "missing"],
      ["null while a track is playing", "null"],
    ])("for %s", async (_label, kind) => {
      const { owner, eventId, a, b } = await eventWithRankedTracks();
      await advance(owner, eventId, null); // b plays
      const versionBefore = await versionOf(eventId);
      const counts = await statusCounts(eventId);
      const claimed = kind === "queued" ? a : kind === "missing" ? MISSING_UUID : null;

      const response = await advance(owner, eventId, claimed);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("QUEUE_CHANGED");
      // The details are the CURRENT queue, so the app can show the truth at once.
      expect(response.body.error.details).toMatchObject({
        eventId,
        version: versionBefore,
      });
      expect(response.body.error.details.tracks[0]).toMatchObject({
        id: b,
        status: "playing",
      });
      expect(await versionOf(eventId)).toBe(versionBefore);
      expect(await statusCounts(eventId)).toEqual(counts);
    });

    it("for a track that already finished", async () => {
      const { owner, eventId, b } = await eventWithRankedTracks();
      await advance(owner, eventId, null);
      await advance(owner, eventId, b);
      const counts = await statusCounts(eventId);

      const response = await advance(owner, eventId, b); // b is played now, c is playing

      expect(response.status).toBe(409);
      expect(await statusCounts(eventId)).toEqual(counts);
    });

    it("for 'null' when nothing is playing but the app thought something was", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);

      const response = await advance(owner, eventId, MISSING_UUID);

      expect(response.status).toBe(409);
      expect(response.body.error.details).toMatchObject({ tracks: [] });
    });

    it("a double tap skips no song: of two identical requests exactly one moves the queue", async () => {
      const { owner, eventId, b, c } = await eventWithRankedTracks();
      await advance(owner, eventId, null); // b plays, c and a are queued

      const [first, second] = await Promise.all([
        advance(owner, eventId, b),
        advance(owner, eventId, b),
      ]);

      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const queue = await queueOf(owner, eventId);
      expect(idsOf(queue)).toEqual(["c", "a"]); // c plays; a was NOT skipped
      expect(queue.tracks[0]).toMatchObject({ id: c, status: "playing" });
      expect(await statusCounts(eventId)).toEqual({ played: 1, playing: 1, queued: 1 });
    });

    it("of 6 simultaneous first advances exactly one starts a track", async () => {
      const { owner, eventId } = await eventWithRankedTracks();

      const responses = await Promise.all(
        Array.from({ length: 6 }, () => advance(owner, eventId, null)),
      );

      expect(responses.map((r) => r.status).sort()).toEqual([
        200, 409, 409, 409, 409, 409,
      ]);
      expect(await statusCounts(eventId)).toEqual({ playing: 1, queued: 2 });
    });

    it("never has two tracks playing, whatever the interleaving", async () => {
      const { owner, eventId } = await eventWithRankedTracks();
      let current: string | null = null;
      for (let round = 0; round < 3; round++) {
        const responses = await Promise.all(
          Array.from({ length: 4 }, () => advance(owner, eventId, current)),
        );
        const winner = responses.find((r) => r.status === 200);
        const queue = winner?.body as QueueBody | undefined;
        current = queue?.tracks.find((t) => t.status === "playing")?.id ?? null;
        expect((await statusCounts(eventId))["playing"] ?? 0).toBeLessThanOrEqual(1);
        expect(responses.filter((r) => r.status === 500)).toEqual([]);
      }
    });
  });

  describe("timestamps stay coherent when requests wait on each other", () => {
    // Request 1 starts the first track, request 2 finishes it. Request 2 is sent while request 1
    // still waits for the event's lock, so request 2's TRANSACTION began earlier than the moment
    // request 1 wrote started_at. With now() the end would be stamped before the start and the
    // lifecycle constraint would reject it (a 500). clock_timestamp() keeps them in order.
    it("ends a track after the moment it started", async () => {
      const { owner, eventId, b } = await eventWithRankedTracks();
      const holder = await pool.connect();
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
        const first = advance(owner, eventId, null).then((r) => r);
        await new Promise((resolve) => setTimeout(resolve, 250));
        const second = advance(owner, eventId, b).then((r) => r); // b is not playing YET, but will be
        await new Promise((resolve) => setTimeout(resolve, 250));
        await holder.query("COMMIT");

        const [r1, r2] = await Promise.all([first, second]);

        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);
        const played = (
          await pool.query(
            "SELECT started_at, ended_at FROM event_tracks WHERE id = $1",
            [b],
          )
        ).rows[0];
        expect(played.ended_at.getTime()).toBeGreaterThanOrEqual(
          played.started_at.getTime(),
        );
      } finally {
        await holder.query("ROLLBACK").catch(() => undefined); // never hand a connection back inside an open transaction
        holder.release();
      }
    });
  });

  describe("racing with votes", () => {
    it("never loses or invents a vote: each vote lands before the track starts or is refused after", async () => {
      const { owner, eventId, c } = await eventWithRankedTracks(); // order b, c, a
      await advance(owner, eventId, null); // b plays
      const voters = await Promise.all(
        Array.from({ length: 20 }, (_, i) => makeUser(`racer-${i}`)),
      );

      // The owner advances (c starts playing) while 20 people vote for c.
      const [advanced, ...votes] = await Promise.all([
        advance(owner, eventId, (await queueOf(owner, eventId)).tracks[0]!.id),
        ...voters.map((v) => vote(v, eventId, c)),
      ]);

      expect(advanced.status).toBe(200);
      const accepted = votes.filter((v) => v.status === 200).length;
      const refused = votes.filter(
        (v) => v.status === 409 && v.body.error.code === "TRACK_NOT_VOTABLE",
      ).length;
      expect(accepted + refused).toBe(20); // nothing else (no 500, no lost request)
      const stored = (
        await pool.query("SELECT vote_count FROM event_tracks WHERE id = $1", [c])
      ).rows[0].vote_count;
      expect(stored).toBe(2 + accepted); // the 2 it had, plus exactly the accepted ones
      const bad = await pool.query(
        `SELECT t.id FROM event_tracks t WHERE t.event_id = $1
           AND t.vote_count <> (SELECT count(*) FROM event_track_votes v WHERE v.track_id = t.id)`,
        [eventId],
      );
      expect(bad.rowCount).toBe(0);
    });
  });
});
