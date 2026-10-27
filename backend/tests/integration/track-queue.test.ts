import { createServer, type Server } from "node:http";
import type { Express } from "express";
import type { Track } from "@music-room/shared";
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

// Suggesting, voting and reading the queue against a real, migrated Postgres
// (set TEST_DATABASE_URL; see `make test-integration`). The catalog is a fake.
//
// Rules under test (ADR-008, ADR-014, ADR-016):
//  - suggesting needs the vote license; the catalog is not even asked if it is refused;
//  - a suggestion counts as its author's vote; the same song cannot be queued twice at once;
//  - voting is idempotent and counts are exact however many users vote at once;
//  - withdrawing your own vote needs only that you can still see the event;
//  - the queue version rises on every real change, and only then.
const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(32);
const NAME_PREFIX = "queue-test-";
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";
const NOW = new Date("2026-10-12T20:00:00.000Z");

interface TestUser {
  id: string;
  token: string;
}

const songs = (id: string): Track => ({
  providerTrackId: id,
  title: `Song ${id}`,
  artist: "Some Artist",
  durationSeconds: 200,
  coverUrl: null,
});

describe.skipIf(!databaseUrl)("event queue: suggest, vote, withdraw", () => {
  let pool: pg.Pool;
  let app: Express;
  // One long-lived HTTP server for the whole file instead of one temporary server per
  // request: some tests send 30 requests at once, and this keeps those simple.
  let server: Server;
  let catalogCalls: string[];

  // A fake catalog: ids 1 to 999 exist, "404" does not, "down" is unreachable.
  const catalog: CatalogProvider = {
    search: () => Promise.resolve([]),
    getTrack(id) {
      catalogCalls.push(id);
      if (id === "down")
        return Promise.reject(new CatalogUnavailableError("test outage"));
      if (id === "404") return Promise.resolve(null);
      return Promise.resolve(songs(id));
    },
  };

  beforeAll(() => {
    pool = createPostgresPool(databaseUrl!);
    app = buildApp(NOW);
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

  function buildApp(clockNow: Date): Express {
    return createApp({
      pool,
      jwtSecret: SECRET,
      logger: pino({ level: "silent" }),
      catalog,
      clock: () => clockNow,
      suggestLimit: { windowMs: 60_000, limit: 100_000 },
    });
  }

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
    method: "get" | "post" | "put" | "delete" | "patch",
    path: string,
    user?: TestUser,
    target: Express = app,
  ) => {
    // The shared server for the default app; other apps (other clock, other limits) get their own.
    const req = request(target === app ? server : target)[method](`/api/v1${path}`);
    return user ? req.set("Authorization", `Bearer ${user.token}`) : req;
  };
  const createEvent = async (
    owner: TestUser,
    body: object = { name: "E" },
  ): Promise<string> => (await call("post", "/events", owner).send(body)).body.id;
  const suggest = (
    user: TestUser,
    eventId: string,
    providerTrackId: string,
    extra: object = {},
  ) =>
    call("post", `/events/${eventId}/tracks`, user).send({ providerTrackId, ...extra });
  const vote = (
    user: TestUser,
    eventId: string,
    trackId: string,
    body?: object,
    target?: Express,
  ) => {
    const req = call("put", `/events/${eventId}/tracks/${trackId}/vote`, user, target);
    return body ? req.send(body) : req;
  };
  const withdraw = (user: TestUser, eventId: string, trackId: string) =>
    call("delete", `/events/${eventId}/tracks/${trackId}/vote`, user);
  const queueOf = (user: TestUser, eventId: string) =>
    call("get", `/events/${eventId}/tracks`, user);
  const invite = (eventId: string, userId: string) =>
    pool.query("INSERT INTO event_invitations (event_id, user_id) VALUES ($1, $2)", [
      eventId,
      userId,
    ]);
  const versionOf = async (eventId: string) =>
    Number(
      (await pool.query("SELECT queue_version FROM events WHERE id = $1", [eventId]))
        .rows[0].queue_version,
    );
  const countRows = async (table: string, eventId: string) =>
    Number(
      (await pool.query(`SELECT count(*) FROM ${table} WHERE event_id = $1`, [eventId]))
        .rows[0].count,
    );

  /** The counter of every track must equal the number of vote rows: the invariant of ADR-008. */
  async function expectCountersConsistent(eventId: string) {
    const bad = await pool.query(
      `SELECT t.id FROM event_tracks t WHERE t.event_id = $1
         AND t.vote_count <> (SELECT count(*) FROM event_track_votes v WHERE v.track_id = t.id)`,
      [eventId],
    );
    expect(bad.rowCount).toBe(0);
  }

  const paris = { latitude: 48.8566, longitude: 2.3522 };
  const locationLicense = {
    type: "location_time",
    ...paris,
    radiusMeters: 500,
    startsAt: "2026-10-12T18:00:00.000Z",
    endsAt: "2026-10-12T22:00:00.000Z",
  };
  const inside = {
    latitude: paris.latitude,
    longitude: paris.longitude,
    accuracyMeters: 10,
  };

  describe("authentication", () => {
    it.each([
      ["get", `/events/${MISSING_UUID}/tracks`],
      ["post", `/events/${MISSING_UUID}/tracks`],
      ["put", `/events/${MISSING_UUID}/tracks/${MISSING_UUID}/vote`],
      ["delete", `/events/${MISSING_UUID}/tracks/${MISSING_UUID}/vote`],
    ] as const)("%s %s requires a token", async (method, path) => {
      expect((await call(method, path)).status).toBe(401);
    });
  });

  describe("GET /events/{id}/tracks", () => {
    it("returns an empty queue at version 0 for a new event", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);

      const response = await queueOf(owner, eventId);

      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toEqual({ eventId, version: 0, tracks: [] });
    });

    it("puts the playing track first, then the queued ones by votes, then oldest suggestion; never played ones", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);
      const insertTrack = (
        id: string,
        votes: number,
        suggestedAt: string,
        extra = "'queued', NULL, NULL",
      ) =>
        pool.query(
          `INSERT INTO event_tracks (event_id, provider_track_id, title, artist, duration_seconds,
                                     suggested_by, vote_count, suggested_at, status, started_at, ended_at)
           VALUES ($1, $2, $3, 'A', 100, $4, $5, $6, ${extra})`,
          [eventId, id, `Song ${id}`, owner.id, votes, suggestedAt],
        );
      await insertTrack("low", 1, "2026-10-12T10:00:00Z");
      await insertTrack("tie-old", 5, "2026-10-12T10:00:00Z");
      await insertTrack("tie-new", 5, "2026-10-12T11:00:00Z");
      await insertTrack("top", 9, "2026-10-12T12:00:00Z");
      await insertTrack("playing", 0, "2026-10-12T09:00:00Z", "'playing', now(), NULL");
      await insertTrack("done", 99, "2026-10-12T08:00:00Z", "'played', now(), now()");

      const response = await queueOf(owner, eventId);

      expect(
        response.body.tracks.map(
          (t: { track: { providerTrackId: string } }) => t.track.providerTrackId,
        ),
      ).toEqual(["playing", "top", "tie-old", "tie-new", "low"]);
    });

    it("breaks ties on id when votes and suggestion time are identical", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);
      const ids = [];
      for (const id of ["a", "b", "c"]) {
        const { rows } = await pool.query(
          `INSERT INTO event_tracks (event_id, provider_track_id, title, artist, duration_seconds, suggested_by, vote_count, suggested_at)
           VALUES ($1, $2, 't', 'a', 1, $3, 2, '2026-10-12T10:00:00Z') RETURNING id`,
          [eventId, id, owner.id],
        );
        ids.push(rows[0].id);
      }

      const listed = (await queueOf(owner, eventId)).body.tracks.map(
        (t: { id: string }) => t.id,
      );

      expect(listed).toEqual([...ids].sort());
    });

    it("tells each user which tracks THEY voted for", async () => {
      const owner = await makeUser("owner");
      const other = await makeUser("other");
      const eventId = await createEvent(owner);
      const mine = (await suggest(owner, eventId, "1")).body.id;
      await suggest(other, eventId, "2");

      const asOwner = (await queueOf(owner, eventId)).body.tracks;
      const asOther = (await queueOf(other, eventId)).body.tracks;

      expect(asOwner.find((t: { id: string }) => t.id === mine).votedByMe).toBe(true);
      expect(asOther.find((t: { id: string }) => t.id === mine).votedByMe).toBe(false);
    });

    it("reports the stored version", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);
      await suggest(owner, eventId, "1");
      await suggest(owner, eventId, "2");

      expect((await queueOf(owner, eventId)).body.version).toBe(2);
    });

    it("can be read by anyone who can see the event, even without the right to vote", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const eventId = await createEvent(owner, {
        name: "E",
        voteLicense: { type: "invited_only" },
      });

      expect((await queueOf(stranger, eventId)).status).toBe(200);
    });

    it("answers a hidden private event exactly like a missing one", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const eventId = await createEvent(owner, { name: "E", visibility: "private" });

      const hidden = await queueOf(stranger, eventId);
      const missing = await queueOf(stranger, MISSING_UUID);

      expect(hidden.status).toBe(404);
      expect(hidden.body).toEqual(missing.body);
    });

    it("shows a private event's queue to an invited user", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const eventId = await createEvent(owner, { name: "E", visibility: "private" });
      await invite(eventId, guest.id);

      expect((await queueOf(guest, eventId)).status).toBe(200);
    });
  });

  describe("POST /events/{id}/tracks (suggest)", () => {
    it("queues the track with data from the catalog and counts it as the author's vote", async () => {
      const owner = await makeUser("owner");
      const author = await makeUser("author");
      const eventId = await createEvent(owner);

      const response = await suggest(author, eventId, "42");

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        eventId,
        track: songs("42"),
        suggestedBy: author.id,
        voteCount: 1,
        votedByMe: true,
        status: "queued",
      });
      expect(Date.parse(response.body.suggestedAt)).not.toBeNaN();
      const votes = await pool.query(
        "SELECT user_id FROM event_track_votes WHERE track_id = $1",
        [response.body.id],
      );
      expect(votes.rows.map((r) => r.user_id)).toEqual([author.id]);
      expect(await versionOf(eventId)).toBe(1);
    });

    it("never takes title, artist or cover from the client", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);

      const response = await suggest(owner, eventId, "42", {
        title: "Hacked",
        artist: "Evil",
      });

      expect(response.status).toBe(400);
      expect(await countRows("event_tracks", eventId)).toBe(0);
      expect(catalogCalls).toEqual([]);
    });

    it.each([
      ["a missing id", {}],
      ["an empty id", { providerTrackId: "" }],
      ["an id over 64 characters", { providerTrackId: "x".repeat(65) }],
      ["an id with a path in it", { providerTrackId: "../user/me" }],
      ["an id with a space", { providerTrackId: "1 2" }],
      ["a numeric id", { providerTrackId: 42 }],
      [
        "a location with a latitude of 91",
        { providerTrackId: "1", location: { latitude: 91, longitude: 0 } },
      ],
      [
        "a location with an extra field",
        { providerTrackId: "1", location: { latitude: 1, longitude: 1, speed: 3 } },
      ],
      [
        "a negative accuracy",
        {
          providerTrackId: "1",
          location: { latitude: 1, longitude: 1, accuracyMeters: -5 },
        },
      ],
    ])("answers 400 for %s", async (_label, body) => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);

      const response = await call("post", `/events/${eventId}/tracks`, owner).send(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(catalogCalls).toEqual([]);
    });

    it("answers 404 TRACK_NOT_FOUND for a track the catalog does not know, storing nothing", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);

      const response = await suggest(owner, eventId, "404");

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("TRACK_NOT_FOUND");
      expect(await countRows("event_tracks", eventId)).toBe(0);
      expect(await versionOf(eventId)).toBe(0);
    });

    it("answers 502 PROVIDER_UNAVAILABLE when the catalog is down, storing nothing", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);

      const response = await suggest(owner, eventId, "down");

      expect(response.status).toBe(502);
      expect(response.body.error.code).toBe("PROVIDER_UNAVAILABLE");
      expect(await countRows("event_tracks", eventId)).toBe(0);
      expect(await versionOf(eventId)).toBe(0);
    });

    describe("who may suggest (the vote license)", () => {
      it("lets anyone who can see a public 'everyone' event", async () => {
        const owner = await makeUser("owner");
        const stranger = await makeUser("stranger");
        const eventId = await createEvent(owner);

        expect((await suggest(stranger, eventId, "1")).status).toBe(201);
      });

      it("refuses a stranger on an invited_only event with 403 and never asks the catalog", async () => {
        const owner = await makeUser("owner");
        const stranger = await makeUser("stranger");
        const eventId = await createEvent(owner, {
          name: "E",
          voteLicense: { type: "invited_only" },
        });

        const response = await suggest(stranger, eventId, "1");

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe("NOT_INVITED");
        expect(catalogCalls).toEqual([]);
        expect(await countRows("event_tracks", eventId)).toBe(0);
      });

      it("lets an invited user, and the owner, suggest on an invited_only event", async () => {
        const owner = await makeUser("owner");
        const guest = await makeUser("guest");
        const eventId = await createEvent(owner, {
          name: "E",
          voteLicense: { type: "invited_only" },
        });
        await invite(eventId, guest.id);

        expect((await suggest(guest, eventId, "1")).status).toBe(201);
        expect((await suggest(owner, eventId, "2")).status).toBe(201);
      });

      it("answers 404 for a hidden private event and never asks the catalog", async () => {
        const owner = await makeUser("owner");
        const stranger = await makeUser("stranger");
        const eventId = await createEvent(owner, { name: "E", visibility: "private" });

        const response = await suggest(stranger, eventId, "1");

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe("EVENT_NOT_FOUND");
        expect(catalogCalls).toEqual([]);
      });

      it("answers 404 for an event that does not exist", async () => {
        const user = await makeUser("user");

        expect((await suggest(user, MISSING_UUID, "1")).status).toBe(404);
      });

      it("stops a user whose invitation was removed", async () => {
        const owner = await makeUser("owner");
        const guest = await makeUser("guest");
        const eventId = await createEvent(owner, {
          name: "E",
          voteLicense: { type: "invited_only" },
        });
        await invite(eventId, guest.id);
        expect((await suggest(guest, eventId, "1")).status).toBe(201);

        await call("delete", `/events/${eventId}/invitations/${guest.id}`, owner);

        expect((await suggest(guest, eventId, "2")).status).toBe(403);
      });

      describe("location_time", () => {
        it("asks for a location when none is sent, before calling the catalog", async () => {
          const owner = await makeUser("owner");
          const voter = await makeUser("voter");
          const eventId = await createEvent(owner, {
            name: "E",
            voteLicense: locationLicense,
          });

          const response = await suggest(voter, eventId, "1");

          expect(response.status).toBe(400);
          expect(response.body.error.code).toBe("LOCATION_REQUIRED");
          expect(catalogCalls).toEqual([]);
        });

        it("accepts someone inside the area during the window", async () => {
          const owner = await makeUser("owner");
          const voter = await makeUser("voter");
          const eventId = await createEvent(owner, {
            name: "E",
            voteLicense: locationLicense,
          });

          expect((await suggest(voter, eventId, "1", { location: inside })).status).toBe(
            201,
          );
        });

        it("refuses someone outside the area", async () => {
          const owner = await makeUser("owner");
          const voter = await makeUser("voter");
          const eventId = await createEvent(owner, {
            name: "E",
            voteLicense: locationLicense,
          });

          const response = await suggest(voter, eventId, "1", {
            location: { ...inside, latitude: paris.latitude + 0.02 },
          });

          expect(response.status).toBe(403);
          expect(response.body.error.code).toBe("OUTSIDE_VOTING_AREA");
          expect(catalogCalls).toEqual([]);
        });

        it("refuses a position that is too imprecise", async () => {
          const owner = await makeUser("owner");
          const voter = await makeUser("voter");
          const eventId = await createEvent(owner, {
            name: "E",
            voteLicense: locationLicense,
          });

          const response = await suggest(voter, eventId, "1", {
            location: { ...inside, accuracyMeters: 500 },
          });

          expect(response.status).toBe(400);
          expect(response.body.error.code).toBe("LOCATION_REQUIRED");
        });

        it("judges the time by the SERVER clock, not the client's", async () => {
          const owner = await makeUser("owner");
          const voter = await makeUser("voter");
          const eventId = await createEvent(owner, {
            name: "E",
            voteLicense: locationLicense,
          });
          const lateApp = buildApp(new Date("2026-10-12T23:00:00Z"));

          const response = await call(
            "post",
            `/events/${eventId}/tracks`,
            voter,
            lateApp,
          ).send({
            providerTrackId: "1",
            location: inside,
            now: "2026-10-12T20:00:00Z", // a client-claimed time is not even a field
          });
          const honest = await call(
            "post",
            `/events/${eventId}/tracks`,
            voter,
            lateApp,
          ).send({
            providerTrackId: "1",
            location: inside,
          });

          expect(response.status).toBe(400); // unknown field
          expect(honest.status).toBe(403);
          expect(honest.body.error.code).toBe("OUTSIDE_VOTING_TIME");
        });

        it("does not let the owner's own events be locked out by the rule", async () => {
          const owner = await makeUser("owner");
          const eventId = await createEvent(owner, {
            name: "E",
            voteLicense: locationLicense,
          });

          expect((await suggest(owner, eventId, "1")).status).toBe(201);
        });
      });
    });

    describe("the same song twice", () => {
      it("answers 409 TRACK_ALREADY_QUEUED with the existing track, counting nothing twice", async () => {
        const owner = await makeUser("owner");
        const other = await makeUser("other");
        const eventId = await createEvent(owner);
        const first = (await suggest(owner, eventId, "7")).body;

        const response = await suggest(other, eventId, "7");

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe("TRACK_ALREADY_QUEUED");
        expect(response.body.error.details).toMatchObject({
          id: first.id,
          voteCount: 1,
          votedByMe: false,
        });
        expect(await countRows("event_tracks", eventId)).toBe(1);
        expect(await versionOf(eventId)).toBe(1);
      });

      it("is allowed again once the song is playing or has been played", async () => {
        const owner = await makeUser("owner");
        const eventId = await createEvent(owner);
        const first = (await suggest(owner, eventId, "7")).body.id;
        await pool.query(
          "UPDATE event_tracks SET status = 'playing', started_at = now() WHERE id = $1",
          [first],
        );

        const again = await suggest(owner, eventId, "7");

        expect(again.status).toBe(201);
        expect(again.body.id).not.toBe(first);
      });

      it("lets exactly one of 8 simultaneous suggestions of one song win", async () => {
        const owner = await makeUser("owner");
        const users = await Promise.all(
          Array.from({ length: 8 }, (_, i) => makeUser(`racer-${i}`)),
        );
        const eventId = await createEvent(owner);

        const responses = await Promise.all(users.map((u) => suggest(u, eventId, "7")));

        expect(responses.map((r) => r.status).sort()).toEqual([
          201, 409, 409, 409, 409, 409, 409, 409,
        ]);
        const winner = responses.find((r) => r.status === 201)!.body;
        for (const loser of responses.filter((r) => r.status === 409)) {
          expect(loser.body.error.details.id).toBe(winner.id);
        }
        expect(await countRows("event_tracks", eventId)).toBe(1);
        expect(await versionOf(eventId)).toBe(1);
        await expectCountersConsistent(eventId);
      });
    });

    it("keeps different songs separate", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);

      await suggest(owner, eventId, "1");
      await suggest(owner, eventId, "2");

      expect(await countRows("event_tracks", eventId)).toBe(2);
      expect(await versionOf(eventId)).toBe(2);
    });
  });

  describe("PUT /events/{id}/tracks/{trackId}/vote", () => {
    async function eventWithTrack() {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);
      const trackId = (await suggest(owner, eventId, "1")).body.id as string;
      return { owner, eventId, trackId };
    }

    it("adds the vote and answers with the new count", async () => {
      const { eventId, trackId } = await eventWithTrack();
      const voter = await makeUser("voter");

      const response = await vote(voter, eventId, trackId);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: trackId, voteCount: 2, votedByMe: true });
      expect(await versionOf(eventId)).toBe(2);
      await expectCountersConsistent(eventId);
    });

    it("is idempotent: voting again changes neither the count nor the version", async () => {
      const { eventId, trackId } = await eventWithTrack();
      const voter = await makeUser("voter");
      await vote(voter, eventId, trackId);
      const versionBefore = await versionOf(eventId);

      const again = await vote(voter, eventId, trackId);

      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ voteCount: 2, votedByMe: true });
      expect(await versionOf(eventId)).toBe(versionBefore);
    });

    it("does not let the author vote twice for their own suggestion", async () => {
      const { owner, eventId, trackId } = await eventWithTrack();

      const response = await vote(owner, eventId, trackId);

      expect(response.body.voteCount).toBe(1);
    });

    it("lets a user vote for several tracks", async () => {
      const { eventId, trackId, owner } = await eventWithTrack();
      const second = (await suggest(owner, eventId, "2")).body.id;
      const voter = await makeUser("voter");

      await vote(voter, eventId, trackId);
      await vote(voter, eventId, second);

      const tracks = (await queueOf(voter, eventId)).body.tracks;
      expect(tracks.every((t: { votedByMe: boolean }) => t.votedByMe)).toBe(true);
    });

    it("moves a track up the queue once it has more votes", async () => {
      const { eventId, owner } = await eventWithTrack(); // track "1" has 1 vote
      const second = (await suggest(owner, eventId, "2")).body.id as string; // 1 vote, newer
      const voter = await makeUser("voter");
      expect((await queueOf(voter, eventId)).body.tracks[0].track.providerTrackId).toBe(
        "1",
      );

      await vote(voter, eventId, second);

      const tracks = (await queueOf(voter, eventId)).body.tracks;
      expect(
        tracks.map(
          (t: { track: { providerTrackId: string } }) => t.track.providerTrackId,
        ),
      ).toEqual(["2", "1"]);
    });

    describe("who may vote", () => {
      it("refuses a stranger on an invited_only event with 403", async () => {
        const owner = await makeUser("owner");
        const stranger = await makeUser("stranger");
        const eventId = await createEvent(owner, {
          name: "E",
          voteLicense: { type: "invited_only" },
        });
        const trackId = (await suggest(owner, eventId, "1")).body.id;

        const response = await vote(stranger, eventId, trackId);

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe("NOT_INVITED");
        await expectCountersConsistent(eventId);
        expect((await queueOf(owner, eventId)).body.tracks[0].voteCount).toBe(1);
      });

      it("lets an invited user vote", async () => {
        const owner = await makeUser("owner");
        const guest = await makeUser("guest");
        const eventId = await createEvent(owner, {
          name: "E",
          voteLicense: { type: "invited_only" },
        });
        const trackId = (await suggest(owner, eventId, "1")).body.id;
        await invite(eventId, guest.id);

        expect((await vote(guest, eventId, trackId)).status).toBe(200);
      });

      it("answers 404 for a hidden private event, whatever the track id", async () => {
        const owner = await makeUser("owner");
        const stranger = await makeUser("stranger");
        const eventId = await createEvent(owner, { name: "E", visibility: "private" });
        const trackId = (await suggest(owner, eventId, "1")).body.id;

        expect((await vote(stranger, eventId, trackId)).status).toBe(404);
      });

      it("needs the location for a location_time event, and judges it", async () => {
        const owner = await makeUser("owner");
        const voter = await makeUser("voter");
        const eventId = await createEvent(owner, {
          name: "E",
          voteLicense: locationLicense,
        });
        const trackId = (await suggest(owner, eventId, "1")).body.id;

        const without = await vote(voter, eventId, trackId);
        const far = await vote(voter, eventId, trackId, {
          location: { ...inside, latitude: 49.5 },
        });
        const near = await vote(voter, eventId, trackId, { location: inside });

        expect(without.status).toBe(400);
        expect(without.body.error.code).toBe("LOCATION_REQUIRED");
        expect(far.status).toBe(403);
        expect(far.body.error.code).toBe("OUTSIDE_VOTING_AREA");
        expect(near.status).toBe(200);
        expect(near.body.voteCount).toBe(2);
      });
    });

    describe("which track", () => {
      it("answers 404 TRACK_NOT_FOUND for an unknown track", async () => {
        const { eventId } = await eventWithTrack();
        const voter = await makeUser("voter");

        const response = await vote(voter, eventId, MISSING_UUID);

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe("TRACK_NOT_FOUND");
      });

      it("cannot reach a track of ANOTHER event through this event's URL", async () => {
        const { owner, trackId } = await eventWithTrack();
        const otherEvent = await createEvent(owner, { name: "Other" });
        const voter = await makeUser("voter");

        const response = await vote(voter, otherEvent, trackId);

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe("TRACK_NOT_FOUND");
        expect(
          (
            await pool.query("SELECT vote_count FROM event_tracks WHERE id = $1", [
              trackId,
            ])
          ).rows[0].vote_count,
        ).toBe(1);
      });

      it("answers 400 for ids that are not UUIDs", async () => {
        const { eventId } = await eventWithTrack();
        const voter = await makeUser("voter");

        expect((await vote(voter, eventId, "42")).status).toBe(400);
        expect((await vote(voter, "42", MISSING_UUID)).status).toBe(400);
      });

      it.each(["playing", "played"])(
        "answers 409 TRACK_NOT_VOTABLE for a %s track",
        async (status) => {
          const { eventId, trackId } = await eventWithTrack();
          const voter = await makeUser("voter");
          const times = status === "playing" ? "now(), NULL" : "now(), now()";
          await pool.query(
            `UPDATE event_tracks SET status = $2, started_at = ${times.split(",")[0]}, ended_at = ${times.split(",")[1]} WHERE id = $1`,
            [trackId, status],
          );
          const versionBefore = await versionOf(eventId);

          const response = await vote(voter, eventId, trackId);

          expect(response.status).toBe(409);
          expect(response.body.error.code).toBe("TRACK_NOT_VOTABLE");
          expect(await versionOf(eventId)).toBe(versionBefore);
        },
      );
    });

    it("rejects an unknown field and a bad location in the body", async () => {
      const { eventId, trackId } = await eventWithTrack();
      const voter = await makeUser("voter");

      expect((await vote(voter, eventId, trackId, { color: "red" })).status).toBe(400);
      expect(
        (
          await vote(voter, eventId, trackId, {
            location: { latitude: 100, longitude: 0 },
          })
        ).status,
      ).toBe(400);
    });

    describe("simultaneous votes (ADR-008)", () => {
      it("never loses a vote: 30 users voting for one track at once give exactly 31", async () => {
        const { eventId, trackId } = await eventWithTrack();
        const voters = await Promise.all(
          Array.from({ length: 30 }, (_, i) => makeUser(`voter-${i}`)),
        );

        const responses = await Promise.all(voters.map((v) => vote(v, eventId, trackId)));

        expect(responses.every((r) => r.status === 200)).toBe(true);
        const stored = (
          await pool.query("SELECT vote_count FROM event_tracks WHERE id = $1", [trackId])
        ).rows[0].vote_count;
        expect(stored).toBe(31);
        expect(await versionOf(eventId)).toBe(31); // 1 suggestion + 30 votes
        await expectCountersConsistent(eventId);
      });

      it("counts once when one user votes 10 times at once", async () => {
        const { eventId, trackId } = await eventWithTrack();
        const voter = await makeUser("voter");

        const responses = await Promise.all(
          Array.from({ length: 10 }, () => vote(voter, eventId, trackId)),
        );

        expect(responses.every((r) => r.status === 200)).toBe(true);
        expect(
          (
            await pool.query("SELECT vote_count FROM event_tracks WHERE id = $1", [
              trackId,
            ])
          ).rows[0].vote_count,
        ).toBe(2);
        expect(await versionOf(eventId)).toBe(2);
        await expectCountersConsistent(eventId);
      });

      it("counts each track correctly when users vote for different tracks at once", async () => {
        const owner = await makeUser("owner");
        const eventId = await createEvent(owner);
        const trackIds: string[] = [];
        for (const id of ["1", "2", "3"])
          trackIds.push((await suggest(owner, eventId, id)).body.id as string);
        const voters = await Promise.all(
          Array.from({ length: 24 }, (_, i) => makeUser(`voter-${i}`)),
        );

        await Promise.all(voters.map((v, i) => vote(v, eventId, trackIds[i % 3]!)));

        const counts = await pool.query(
          "SELECT vote_count FROM event_tracks WHERE event_id = $1 ORDER BY provider_track_id",
          [eventId],
        );
        expect(counts.rows.map((r) => r.vote_count)).toEqual([9, 9, 9]); // 1 own + 8 each
        await expectCountersConsistent(eventId);
      });

      it("keeps the counters equal to the vote rows when votes and withdrawals race", async () => {
        const { eventId, trackId } = await eventWithTrack();
        const voters = await Promise.all(
          Array.from({ length: 20 }, (_, i) => makeUser(`voter-${i}`)),
        );
        for (const v of voters.slice(0, 10)) await vote(v, eventId, trackId); // 10 already voted

        // The first 10 withdraw while the last 10 vote, and everyone also repeats themselves.
        await Promise.all([
          ...voters
            .slice(0, 10)
            .flatMap((v) => [
              withdraw(v, eventId, trackId),
              withdraw(v, eventId, trackId),
            ]),
          ...voters
            .slice(10)
            .flatMap((v) => [vote(v, eventId, trackId), vote(v, eventId, trackId)]),
        ]);

        const stored = (
          await pool.query("SELECT vote_count FROM event_tracks WHERE id = $1", [trackId])
        ).rows[0].vote_count;
        expect(stored).toBe(11); // the author + the 10 who stayed
        await expectCountersConsistent(eventId);
      });

      it("ends up consistent whatever order one user's vote and withdraw land in", async () => {
        const { eventId, trackId } = await eventWithTrack();
        const voters = await Promise.all(
          Array.from({ length: 15 }, (_, i) => makeUser(`voter-${i}`)),
        );

        await Promise.all(
          voters.flatMap((v) => [
            vote(v, eventId, trackId),
            withdraw(v, eventId, trackId),
          ]),
        );

        await expectCountersConsistent(eventId);
        const rows = Number(
          (
            await pool.query(
              "SELECT count(*) FROM event_track_votes WHERE track_id = $1",
              [trackId],
            )
          ).rows[0].count,
        );
        expect(rows).toBeGreaterThanOrEqual(1);
        expect(rows).toBeLessThanOrEqual(16);
      });
    });
  });

  describe("DELETE /events/{id}/tracks/{trackId}/vote (withdraw)", () => {
    async function votedTrack() {
      const owner = await makeUser("owner");
      const voter = await makeUser("voter");
      const eventId = await createEvent(owner);
      const trackId = (await suggest(owner, eventId, "1")).body.id as string;
      await vote(voter, eventId, trackId);
      return { owner, voter, eventId, trackId };
    }

    it("removes your vote and answers with the new count", async () => {
      const { voter, eventId, trackId } = await votedTrack();

      const response = await withdraw(voter, eventId, trackId);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ voteCount: 1, votedByMe: false });
      expect(await versionOf(eventId)).toBe(3); // suggest, vote, withdraw
      await expectCountersConsistent(eventId);
    });

    it("is idempotent: withdrawing without a vote changes nothing", async () => {
      const { voter, eventId, trackId } = await votedTrack();
      await withdraw(voter, eventId, trackId);
      const versionBefore = await versionOf(eventId);

      const again = await withdraw(voter, eventId, trackId);

      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ voteCount: 1, votedByMe: false });
      expect(await versionOf(eventId)).toBe(versionBefore);
    });

    it("never takes away somebody else's vote", async () => {
      const { owner, eventId, trackId } = await votedTrack();
      const bystander = await makeUser("bystander");

      const response = await withdraw(bystander, eventId, trackId);

      expect(response.body.voteCount).toBe(2);
      expect((await queueOf(owner, eventId)).body.tracks[0].voteCount).toBe(2);
    });

    it("can be done outside the voting area: it needs only that you can see the event", async () => {
      const owner = await makeUser("owner");
      const voter = await makeUser("voter");
      const eventId = await createEvent(owner, {
        name: "E",
        voteLicense: locationLicense,
      });
      const trackId = (await suggest(owner, eventId, "1")).body.id as string;
      await vote(voter, eventId, trackId, { location: inside });

      const response = await withdraw(voter, eventId, trackId); // no location sent at all

      expect(response.status).toBe(200);
      expect(response.body.voteCount).toBe(1);
    });

    it("can be done after the invitation was removed, while the event is still visible", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const eventId = await createEvent(owner, {
        name: "E",
        voteLicense: { type: "invited_only" },
      });
      const trackId = (await suggest(owner, eventId, "1")).body.id as string;
      await invite(eventId, guest.id);
      await vote(guest, eventId, trackId);
      await call("delete", `/events/${eventId}/invitations/${guest.id}`, owner);

      const response = await withdraw(guest, eventId, trackId);

      expect(response.status).toBe(200);
      expect(response.body.voteCount).toBe(1);
    });

    it("answers 404 when the event is hidden from you, even if you once voted", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const eventId = await createEvent(owner, { name: "E", visibility: "private" });
      const trackId = (await suggest(owner, eventId, "1")).body.id as string;
      await invite(eventId, guest.id);
      await vote(guest, eventId, trackId);
      await call("delete", `/events/${eventId}/invitations/${guest.id}`, owner);

      expect((await withdraw(guest, eventId, trackId)).status).toBe(404);
      expect(
        (await pool.query("SELECT vote_count FROM event_tracks WHERE id = $1", [trackId]))
          .rows[0].vote_count,
      ).toBe(2);
    });

    it.each(["playing", "played"])(
      "answers 409 TRACK_NOT_VOTABLE for a %s track",
      async (status) => {
        const { voter, eventId, trackId } = await votedTrack();
        const ended = status === "played" ? "now()" : "NULL";
        await pool.query(
          `UPDATE event_tracks SET status = $2, started_at = now(), ended_at = ${ended} WHERE id = $1`,
          [trackId, status],
        );

        const response = await withdraw(voter, eventId, trackId);

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe("TRACK_NOT_VOTABLE");
      },
    );

    it("answers 404 for an unknown track and for a track of another event", async () => {
      const { owner, voter, eventId, trackId } = await votedTrack();
      const otherEvent = await createEvent(owner, { name: "Other" });

      expect((await withdraw(voter, eventId, MISSING_UUID)).body.error.code).toBe(
        "TRACK_NOT_FOUND",
      );
      expect((await withdraw(voter, otherEvent, trackId)).body.error.code).toBe(
        "TRACK_NOT_FOUND",
      );
    });
  });

  describe("the permission is checked again under the event's lock", () => {
    // The owner is in the middle of changing the license: we hold the event's row lock in
    // our own transaction. A request sent now passes the quick, lock-free check (the license
    // is still "everyone"), then waits for the lock. When we commit "invited_only" it must be
    // refused, because the decision has to use the data as it is NOW, not as it was a moment ago.
    async function withLicenseChangeInProgress<T>(
      eventId: string,
      request: () => Promise<T>,
    ): Promise<T> {
      const owner = await pool.connect();
      try {
        await owner.query("BEGIN");
        await owner.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
        const pending = request().then((response) => response); // .then() sends it NOW (supertest is lazy)
        await new Promise((resolve) => setTimeout(resolve, 300)); // let it reach the lock
        await owner.query(
          "UPDATE events SET vote_license = 'invited_only' WHERE id = $1",
          [eventId],
        );
        await owner.query("COMMIT");
        return await pending;
      } finally {
        await owner.query("ROLLBACK").catch(() => undefined); // never hand a connection back inside an open transaction
        owner.release();
      }
    }

    it("refuses a suggestion made just before the license became invited_only", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const eventId = await createEvent(owner);

      const response = await withLicenseChangeInProgress(eventId, () =>
        suggest(stranger, eventId, "1"),
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("NOT_INVITED");
      expect(await countRows("event_tracks", eventId)).toBe(0);
    });

    it("refuses a vote made just before the license became invited_only", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const eventId = await createEvent(owner);
      const trackId = (await suggest(owner, eventId, "1")).body.id as string;

      const response = await withLicenseChangeInProgress(eventId, () =>
        vote(stranger, eventId, trackId),
      );

      expect(response.status).toBe(403);
      expect(
        (await pool.query("SELECT vote_count FROM event_tracks WHERE id = $1", [trackId]))
          .rows[0].vote_count,
      ).toBe(1);
    });

    it("refuses a vote made just before the event became private", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const eventId = await createEvent(owner);
      const trackId = (await suggest(owner, eventId, "1")).body.id as string;
      const holder = await pool.connect();
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
        const pending = vote(stranger, eventId, trackId).then((response) => response);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await holder.query("UPDATE events SET visibility = 'private' WHERE id = $1", [
          eventId,
        ]);
        await holder.query("COMMIT");

        const response = await pending;

        expect(response.status).toBe(404);
      } finally {
        await holder.query("ROLLBACK").catch(() => undefined); // never hand a connection back inside an open transaction
        holder.release();
      }
    });
  });

  describe("a refused request does not wait for the event's lock", () => {
    // While the lock is held by someone else, a request that is forbidden anyway must be
    // turned away AT ONCE by the cheap check, not queue behind the lock first: otherwise
    // anyone could pile up requests on a busy event just by being refused.
    async function whileEventIsLocked(
      eventId: string,
      request: () => Promise<request.Response>,
    ) {
      const holder = await pool.connect();
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
        const answered = request().then((response) => response);
        const outcome = await Promise.race([
          answered,
          new Promise<"still waiting">((resolve) =>
            setTimeout(() => resolve("still waiting"), 700),
          ),
        ]);
        await holder.query("COMMIT");
        await answered;
        return outcome;
      } finally {
        await holder.query("ROLLBACK").catch(() => undefined); // never hand a connection back inside an open transaction
        holder.release();
      }
    }

    it("for a suggestion", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const eventId = await createEvent(owner, {
        name: "E",
        voteLicense: { type: "invited_only" },
      });

      const outcome = await whileEventIsLocked(eventId, () =>
        suggest(stranger, eventId, "1"),
      );

      expect(outcome).not.toBe("still waiting");
      expect((outcome as request.Response).status).toBe(403);
    });

    it("for a vote", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const eventId = await createEvent(owner, {
        name: "E",
        voteLicense: { type: "invited_only" },
      });
      const trackId = (await suggest(owner, eventId, "1")).body.id as string;

      const outcome = await whileEventIsLocked(eventId, () =>
        vote(stranger, eventId, trackId),
      );

      expect(outcome).not.toBe("still waiting");
      expect((outcome as request.Response).status).toBe(403);
    });

    it("for a withdrawal", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const eventId = await createEvent(owner, { name: "E", visibility: "private" });
      const trackId = (await suggest(owner, eventId, "1")).body.id as string;

      const outcome = await whileEventIsLocked(eventId, () =>
        withdraw(stranger, eventId, trackId),
      );

      expect(outcome).not.toBe("still waiting");
      expect((outcome as request.Response).status).toBe(404);
    });
  });

  describe("withdrawing is checked again under the lock", () => {
    it("refuses a withdrawal made just before the event became private to that user", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const eventId = await createEvent(owner, { name: "E", visibility: "private" });
      const trackId = (await suggest(owner, eventId, "1")).body.id as string;
      await invite(eventId, guest.id);
      await vote(guest, eventId, trackId);
      const holder = await pool.connect();
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
        const pending = withdraw(guest, eventId, trackId).then((response) => response);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await holder.query("DELETE FROM event_invitations WHERE event_id = $1", [
          eventId,
        ]);
        await holder.query("COMMIT");

        const response = await pending;

        expect(response.status).toBe(404);
        expect(
          (
            await pool.query("SELECT vote_count FROM event_tracks WHERE id = $1", [
              trackId,
            ])
          ).rows[0].vote_count,
        ).toBe(2);
      } finally {
        await holder.query("ROLLBACK").catch(() => undefined); // never hand a connection back inside an open transaction
        holder.release();
      }
    });
  });

  describe("rate limit on suggestions", () => {
    it("stops a flood before it reaches the catalog", async () => {
      const owner = await makeUser("owner");
      const eventId = await createEvent(owner);
      const limited = createApp({
        pool,
        jwtSecret: SECRET,
        logger: pino({ level: "silent" }),
        catalog,
        suggestLimit: { windowMs: 60_000, limit: 2 },
      });

      const statuses = [];
      for (const id of ["1", "2", "3"]) {
        statuses.push(
          (
            await call("post", `/events/${eventId}/tracks`, owner, limited).send({
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
