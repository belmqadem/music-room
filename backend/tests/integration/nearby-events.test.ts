import { randomBytes } from "node:crypto";
import type { Express } from "express";
import pg from "pg";
import pino from "pino";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";
import { signAccessToken } from "../../src/modules/auth/access-token.js";
import { distanceMeters } from "../../src/modules/access/rules.js";
import { listNearbyEvents } from "../../src/modules/track-vote/repository.js";

// GET /events/nearby against a real, migrated Postgres (set TEST_DATABASE_URL; see
// `make test-integration`). Every test user is named "nearby-test-*" and is deleted afterwards
// (their rooms and tracks go with them).
//
// Rules under test (ADR-052):
//  - only public "At the venue" rooms, never private ones (even when invited) and never your own;
//  - only rooms on now or starting within 12 hours;
//  - only rooms whose circle comes within 10 km; the ones you are in first, then by distance to
//    their edge; at most 20;
//  - each with the top of its queue (playing first, then Up next), at most 3 tracks;
//  - the point asked about is never written to the request log.
const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(32);
const NAME_PREFIX = "nearby-test-";
const HOUR = 60 * 60 * 1000;

// The Southern Ocean: no room from the dev data is anywhere near it.
const HERE = { latitude: -60, longitude: -140 };
/** A point `meters` north of HERE (one degree of latitude is about 111.2 km). */
const north = (meters: number) => ({
  latitude: HERE.latitude + meters / 111_195,
  longitude: HERE.longitude,
});

interface TestUser {
  id: string;
  token: string;
}

interface RoomOptions {
  name?: string;
  visibility?: "public" | "private";
  at?: { latitude: number; longitude: number };
  radiusMeters?: number;
  /** Offsets from now, in milliseconds. */
  startsIn?: number;
  endsIn?: number;
  license?: "location_time" | "everyone";
}

describe.skipIf(!databaseUrl)("GET /events/nearby", () => {
  let pool: pg.Pool;
  let app: Express;
  const logLines: string[] = [];

  beforeAll(() => {
    pool = createPostgresPool(databaseUrl!);
    const logger = pino(
      { level: "info" },
      { write: (line: string) => logLines.push(line) },
    );
    app = createApp({ pool, jwtSecret: SECRET, logger });
  });
  afterEach(async () => {
    logLines.length = 0;
    await pool.query("DELETE FROM users WHERE display_name LIKE $1", [`${NAME_PREFIX}%`]);
  });
  afterAll(async () => {
    await pool.end();
  });

  async function makeUser(name: string): Promise<TestUser> {
    const { rows } = await pool.query(
      "INSERT INTO users (display_name, plan) VALUES ($1, 'premium') RETURNING id",
      [`${NAME_PREFIX}${name}-${randomBytes(3).toString("hex")}`],
    );
    return {
      id: rows[0].id,
      token: await signAccessToken(rows[0].id, SECRET, { displayNameSet: true }),
    };
  }

  async function makeRoom(owner: TestUser, options: RoomOptions = {}): Promise<string> {
    const at = options.at ?? HERE;
    const now = Date.now();
    const located = (options.license ?? "location_time") === "location_time";
    const { rows } = await pool.query(
      `INSERT INTO events (owner_id, name, visibility, vote_license, latitude, longitude,
                           radius_meters, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        owner.id,
        options.name ?? "Room",
        options.visibility ?? "public",
        located ? "location_time" : "everyone",
        located ? at.latitude : null,
        located ? at.longitude : null,
        located ? (options.radiusMeters ?? 200) : null,
        located ? new Date(now + (options.startsIn ?? -HOUR)) : null,
        located ? new Date(now + (options.endsIn ?? 2 * HOUR)) : null,
      ],
    );
    return rows[0].id;
  }

  const nearby = (user: TestUser | undefined, point: Record<string, unknown> = HERE) => {
    const req = request(app).get("/api/v1/events/nearby").query(point);
    return user ? req.set("Authorization", `Bearer ${user.token}`) : req;
  };
  const idsOf = (body: { items: { event: { id: string } }[] }) =>
    body.items.map((item) => item.event.id);

  it("requires a token", async () => {
    const response = await nearby(undefined);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("refuses a missing or impossible point, and is not taken for an event id", async () => {
    const me = await makeUser("me");

    for (const point of [
      {},
      { latitude: "91", longitude: "0" },
      { latitude: "x", longitude: "0" },
    ]) {
      const response = await nearby(me, point);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      // The error names the field, never the value sent.
      expect(JSON.stringify(response.body)).not.toContain('"91"');
    }
  });

  it("returns a public room near you that is on now, with its details", async () => {
    const owner = await makeUser("owner");
    const me = await makeUser("me");
    const roomId = await makeRoom(owner, { name: "Beach set", at: north(1_000) });

    const response = await nearby(me);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.items).toHaveLength(1);
    const [item] = response.body.items;
    expect(item.event).toMatchObject({
      id: roomId,
      name: "Beach set",
      ownerId: owner.id,
      visibility: "public",
      voteLicense: { type: "location_time", radiusMeters: 200 },
      myPermissions: { canView: true, canAct: true, canManage: false },
    });
    expect(Number.isInteger(item.distanceMeters)).toBe(true);
    expect(Math.abs(item.distanceMeters - 1_000)).toBeLessThanOrEqual(1);
    expect(item.tracks).toEqual([]);
  });

  it("leaves out private rooms (even when invited), other licenses and your own rooms", async () => {
    const owner = await makeUser("owner");
    const me = await makeUser("me");
    const shown = await makeRoom(owner);
    const hidden = await makeRoom(owner, { visibility: "private" });
    await pool.query(
      "INSERT INTO event_invitations (event_id, user_id) VALUES ($1, $2)",
      [hidden, me.id],
    );
    await makeRoom(owner, { license: "everyone" });
    await makeRoom(me);

    const response = await nearby(me);

    expect(idsOf(response.body)).toEqual([shown]);
  });

  it("keeps rooms on now or starting within 12 hours, and drops ended or later ones", async () => {
    const owner = await makeUser("owner");
    const me = await makeUser("me");
    const onNow = await makeRoom(owner);
    const soon = await makeRoom(owner, { startsIn: 11 * HOUR, endsIn: 14 * HOUR });
    await makeRoom(owner, { startsIn: 13 * HOUR, endsIn: 15 * HOUR });
    await makeRoom(owner, { startsIn: -3 * HOUR, endsIn: -HOUR });
    // The window is [start, end): a room that ends right now is over.
    await makeRoom(owner, { startsIn: -3 * HOUR, endsIn: 0 });

    const response = await nearby(me);

    expect(new Set(idsOf(response.body))).toEqual(new Set([onNow, soon]));
  });

  it("keeps a room whose circle comes within 10 km, even if its center is further", async () => {
    const owner = await makeUser("owner");
    const me = await makeUser("me");
    const close = await makeRoom(owner, { at: north(9_000) });
    const wide = await makeRoom(owner, { at: north(15_000), radiusMeters: 6_000 });
    await makeRoom(owner, { at: north(10_500), radiusMeters: 200 });

    const response = await nearby(me);

    expect(new Set(idsOf(response.body))).toEqual(new Set([close, wide]));
  });

  it("puts the rooms you are in first, then the nearest edge first", async () => {
    const owner = await makeUser("owner");
    const me = await makeUser("me");
    // Edge 4.8 km away.
    const far = await makeRoom(owner, { at: north(5_000) });
    // Edge 300 m away.
    const near = await makeRoom(owner, { at: north(500) });
    // You are inside both of these; the closer center wins the tie.
    const insideWide = await makeRoom(owner, { at: north(2_000), radiusMeters: 3_000 });
    const insideHere = await makeRoom(owner, { at: north(50) });

    const response = await nearby(me);

    expect(idsOf(response.body)).toEqual([insideHere, insideWide, near, far]);
  });

  it("returns at most 20 rooms, the nearest ones", async () => {
    const owner = await makeUser("owner");
    const me = await makeUser("me");
    const ids: string[] = [];
    for (let i = 0; i < 22; i += 1)
      ids.push(await makeRoom(owner, { at: north(300 + i * 100) }));

    const response = await nearby(me);

    expect(idsOf(response.body)).toEqual(ids.slice(0, 20));
  });

  it("shows the top of each queue: playing first, then Up next, at most 3", async () => {
    const owner = await makeUser("owner");
    const me = await makeUser("me");
    const roomId = await makeRoom(owner);
    const quietId = await makeRoom(owner, { at: north(500) });
    const addTrack = (id: string, votes: number, status = "'queued', NULL, NULL") =>
      pool.query(
        `INSERT INTO event_tracks (event_id, provider_track_id, title, artist, duration_seconds,
                                   suggested_by, vote_count, suggested_at, status, started_at, ended_at)
         VALUES ($1, $2, $3, $4, 180, $5, $6, now(), ${status})`,
        [roomId, id, `Song ${id}`, `Artist ${id}`, owner.id, votes],
      );
    await addTrack("low", 1);
    await addTrack("top", 9);
    await addTrack("second", 5);
    await addTrack("playing", 0, "'playing', now(), NULL");
    await addTrack("done", 99, "'played', now(), now()");

    const response = await nearby(me);

    const [room, quiet] = response.body.items;
    expect(room.event.id).toBe(roomId);
    expect(room.tracks).toEqual([
      {
        providerTrackId: "playing",
        title: "Song playing",
        artist: "Artist playing",
        durationSeconds: 180,
        coverUrl: null,
      },
      expect.objectContaining({ providerTrackId: "top" }),
      expect.objectContaining({ providerTrackId: "second" }),
    ]);
    expect(quiet.event.id).toBe(quietId);
    expect(quiet.tracks).toEqual([]);
  });

  it("never writes the point to the request log", async () => {
    const me = await makeUser("me");

    const response = await nearby(me, {
      latitude: "-60.123456",
      longitude: "-140.654321",
    });

    expect(response.status).toBe(200);
    const logged = logLines.join("\n");
    expect(logged).toContain("/api/v1/events/nearby");
    expect(logged).not.toContain("60.123456");
    expect(logged).not.toContain("140.654321");
  });

  it("measures distance in SQL exactly as the access rules do", async () => {
    const owner = await makeUser("owner");
    const me = await makeUser("me");
    const venues = [
      north(1),
      north(7_000),
      { latitude: -60.05, longitude: -140.08 },
      { latitude: -59.97, longitude: -139.93 },
    ];
    for (const at of venues) await makeRoom(owner, { at, radiusMeters: 1 });

    const records = await listNearbyEvents(pool, me.id, HERE, {
      withinMeters: 10_000,
      from: new Date(),
      until: new Date(Date.now() + HOUR),
      limit: 20,
    });

    expect(records).toHaveLength(venues.length);
    for (const record of records) {
      if (record.license.type !== "location_time") throw new Error("not a venue room");
      expect(record.distanceMeters).toBeCloseTo(distanceMeters(HERE, record.license), 3);
    }
  });
});
