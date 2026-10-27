import type { Express } from "express";
import pg from "pg";
import pino from "pino";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";
import { signAccessToken } from "../../src/modules/auth/access-token.js";
import { loadEventAccess } from "../../src/modules/access/repository.js";
import { canView } from "../../src/modules/access/rules.js";

// Events CRUD against a real, migrated Postgres (set TEST_DATABASE_URL; see
// `make test-integration`). Every test user is named "events-test-*" and is
// deleted afterwards (their events go with them).
//
// Rules under test (ADR-005, ADR-013, ADR-014):
//  - anyone signed in can create; the creator is the owner and nothing in the body can change that;
//  - a hidden (private, not invited) event is exactly as 404 as a missing one;
//  - only the owner can change or delete; a viewer who is not the owner gets 403;
//  - the list shows public + own + invited events, newest first, and agrees with canView.
const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(32);
const NAME_PREFIX = "events-test-";
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

interface TestUser {
  id: string;
  token: string;
}

describe.skipIf(!databaseUrl)("events", () => {
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
      "INSERT INTO users (display_name, plan) VALUES ($1, 'premium') RETURNING id",
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
  const createEvent = (user: TestUser, body: object = { name: "Friday" }) =>
    call("post", "/events", user).send(body);
  const invite = (eventId: string, userId: string) =>
    pool.query("INSERT INTO event_invitations (event_id, user_id) VALUES ($1, $2)", [
      eventId,
      userId,
    ]);
  const insertEventRow = async (ownerId: string, columns: string, values: unknown[]) =>
    (
      await pool.query(
        `INSERT INTO events (owner_id, ${columns}) VALUES ($1, ${values.map((_, i) => `$${i + 2}`).join(", ")}) RETURNING id`,
        [ownerId, ...values],
      )
    ).rows[0].id as string;

  const locationTime = {
    type: "location_time",
    latitude: 48.8566,
    longitude: 2.3522,
    radiusMeters: 500,
    startsAt: "2026-10-12T18:00:00.000Z",
    endsAt: "2026-10-12T22:00:00.000Z",
  };

  describe("authentication", () => {
    it.each([
      ["post", "/events"],
      ["get", "/events"],
      ["get", `/events/${MISSING_UUID}`],
      ["patch", `/events/${MISSING_UUID}`],
      ["delete", `/events/${MISSING_UUID}`],
    ] as const)("%s %s requires a token", async (method, path) => {
      const response = await call(method, path);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("POST /events", () => {
    it("creates a public event open to everyone, owned by the caller", async () => {
      const owner = await makeUser("owner");

      const response = await createEvent(owner, { name: "  Friday night  " });

      expect(response.status).toBe(201);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toMatchObject({
        name: "Friday night",
        ownerId: owner.id,
        visibility: "public",
        voteLicense: { type: "everyone" },
        myPermissions: { canView: true, canAct: true, canManage: true },
      });
      expect(response.body.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(Date.parse(response.body.createdAt)).not.toBeNaN();
    });

    it("stores a private, location_time event and returns the license unchanged", async () => {
      const owner = await makeUser("owner");

      const response = await createEvent(owner, {
        name: "Park gig",
        visibility: "private",
        voteLicense: locationTime,
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        visibility: "private",
        voteLicense: locationTime,
      });
      const row = await pool.query("SELECT * FROM events WHERE id = $1", [
        response.body.id,
      ]);
      expect(row.rows[0]).toMatchObject({
        vote_license: "location_time",
        latitude: 48.8566,
        radius_meters: 500,
      });
    });

    it("accepts an invited_only license", async () => {
      const owner = await makeUser("owner");

      const response = await createEvent(owner, {
        name: "E",
        voteLicense: { type: "invited_only" },
      });

      expect(response.body.voteLicense).toEqual({ type: "invited_only" });
    });

    it.each([
      ["no name", {}],
      ["a blank name", { name: "  " }],
      ["an unknown visibility", { name: "E", visibility: "secret" }],
      ["an unknown license", { name: "E", voteLicense: { type: "friends" } }],
      [
        "an incomplete location_time license",
        { name: "E", voteLicense: { type: "location_time" } },
      ],
      [
        "a window that ends before it starts",
        { name: "E", voteLicense: { ...locationTime, endsAt: "2026-10-12T10:00:00Z" } },
      ],
    ])("answers 400 for %s and creates nothing", async (_label, body) => {
      const owner = await makeUser("owner");

      const response = await createEvent(owner, body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      const count = await pool.query("SELECT count(*) FROM events WHERE owner_id = $1", [
        owner.id,
      ]);
      expect(Number(count.rows[0].count)).toBe(0);
    });

    it("ignores any attempt to choose the owner, id or creation date", async () => {
      const owner = await makeUser("owner");
      const victim = await makeUser("victim");

      const response = await createEvent(owner, { name: "E", ownerId: victim.id });

      expect(response.status).toBe(400);
      const count = await pool.query("SELECT count(*) FROM events WHERE owner_id = $1", [
        victim.id,
      ]);
      expect(Number(count.rows[0].count)).toBe(0);
    });
  });

  describe("GET /events/{id}", () => {
    it("shows a public event to a stranger, who can act but not manage", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const { body: event } = await createEvent(owner);

      const response = await call("get", `/events/${event.id}`, stranger);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: event.id,
        myPermissions: { canView: true, canAct: true, canManage: false },
      });
    });

    it("reports canAct false for a stranger on an invited_only public event", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const { body: event } = await createEvent(owner, {
        name: "E",
        voteLicense: { type: "invited_only" },
      });

      const response = await call("get", `/events/${event.id}`, stranger);

      expect(response.status).toBe(200);
      expect(response.body.myPermissions).toEqual({
        canView: true,
        canAct: false,
        canManage: false,
      });
    });

    it("shows a private event to its owner and to invited users only", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const stranger = await makeUser("stranger");
      const { body: event } = await createEvent(owner, {
        name: "E",
        visibility: "private",
      });
      await invite(event.id, guest.id);

      expect((await call("get", `/events/${event.id}`, owner)).status).toBe(200);
      const asGuest = await call("get", `/events/${event.id}`, guest);
      expect(asGuest.status).toBe(200);
      expect(asGuest.body.myPermissions).toEqual({
        canView: true,
        canAct: true,
        canManage: false,
      });
      expect((await call("get", `/events/${event.id}`, stranger)).status).toBe(404);
    });

    it("answers a hidden private event exactly like an event that does not exist", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const { body: event } = await createEvent(owner, {
        name: "E",
        visibility: "private",
      });

      const hidden = await call("get", `/events/${event.id}`, stranger);
      const missing = await call("get", `/events/${MISSING_UUID}`, stranger);

      expect(hidden.status).toBe(404);
      expect(hidden.body).toEqual(missing.body);
      expect(hidden.body.error.code).toBe("EVENT_NOT_FOUND");
    });

    it("answers 400 for an id that is not a UUID", async () => {
      const user = await makeUser("user");

      expect((await call("get", "/events/not-a-uuid", user)).status).toBe(400);
    });
  });

  describe("GET /events (list)", () => {
    it("lists public events, own private events and invited private events, not others' private ones", async () => {
      const me = await makeUser("me");
      const other = await makeUser("other");
      const publicOfOther = (await createEvent(other, { name: "public" })).body.id;
      const privateOfOther = (
        await createEvent(other, { name: "hidden", visibility: "private" })
      ).body.id;
      const invitedTo = (
        await createEvent(other, { name: "invited", visibility: "private" })
      ).body.id;
      const mine = (await createEvent(me, { name: "mine", visibility: "private" })).body
        .id;
      await invite(invitedTo, me.id);

      const ids = (await call("get", "/events?limit=100", me)).body.items.map(
        (e: { id: string }) => e.id,
      );

      expect(ids).toEqual(expect.arrayContaining([publicOfOther, invitedTo, mine]));
      expect(ids).not.toContain(privateOfOther);
    });

    it("returns the caller's own permissions on every item", async () => {
      const me = await makeUser("me");
      const other = await makeUser("other");
      const own = (await createEvent(me, { name: "own" })).body.id;
      const theirs = (await createEvent(other, { name: "theirs" })).body.id;

      const items = (await call("get", "/events?limit=100", me)).body.items as {
        id: string;
        myPermissions: { canManage: boolean };
      }[];

      expect(items.find((e) => e.id === own)?.myPermissions.canManage).toBe(true);
      expect(items.find((e) => e.id === theirs)?.myPermissions.canManage).toBe(false);
    });

    it("puts the newest event first", async () => {
      const me = await makeUser("me");
      const first = (await createEvent(me, { name: "first" })).body.id;
      const second = (await createEvent(me, { name: "second" })).body.id;
      const third = (await createEvent(me, { name: "third" })).body.id;

      const ids = (await call("get", "/events?limit=100", me)).body.items
        .map((e: { id: string }) => e.id)
        .filter((id: string) => [first, second, third].includes(id));

      expect(ids).toEqual([third, second, first]);
    });

    it("walks every page once, with no repeat and no gap, even when created_at is identical", async () => {
      const me = await makeUser("me");
      // Private and in the future, so they come first and belong to nobody else's list.
      const created = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          insertEventRow(me.id, "name, visibility, created_at", [
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
          `/events?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
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
      const older = await insertEventRow(me.id, "name, visibility, created_at", [
        "a",
        "private",
        "2032-01-01 00:00:00.000001+00",
      ]);
      const newer = await insertEventRow(me.id, "name, visibility, created_at", [
        "b",
        "private",
        "2032-01-01 00:00:00.000002+00",
      ]);

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const response: request.Response = await call(
          "get",
          `/events?limit=1${cursor ? `&cursor=${cursor}` : ""}`,
          me,
        );
        seen.push(...response.body.items.map((e: { id: string }) => e.id));
        cursor = response.body.nextCursor;
      } while (cursor && seen.length < 200);

      expect(seen.filter((id) => id === older || id === newer)).toEqual([newer, older]);
    });

    it("has no next cursor on the last page", async () => {
      const me = await makeUser("me");
      await createEvent(me);

      const response = await call("get", "/events?limit=100", me);

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

      const response = await call("get", `/events?${query}`, me);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("never reveals a hidden event through a forged cursor", async () => {
      const me = await makeUser("me");
      const other = await makeUser("other");
      const hidden = (await createEvent(other, { name: "hidden", visibility: "private" }))
        .body.id;
      const forged = Buffer.from(
        JSON.stringify({ c: "2999-01-01 00:00:00+00", i: MISSING_UUID }),
      ).toString("base64url");

      const response = await call("get", `/events?limit=100&cursor=${forged}`, me);

      expect(response.status).toBe(200);
      expect(response.body.items.map((e: { id: string }) => e.id)).not.toContain(hidden);
    });

    // The list repeats canView in SQL. Build every combination and check the list,
    // GET /events/{id} and the access engine all give the same answer.
    it("agrees with the access engine and GET /events/{id} for every visibility and relation", async () => {
      const me = await makeUser("me");
      const other = await makeUser("other");
      const cases: { id: string; label: string }[] = [];
      for (const visibility of ["public", "private"] as const) {
        for (const license of [
          { type: "everyone" },
          { type: "invited_only" },
          locationTime,
        ]) {
          for (const relation of ["owned", "invited", "stranger"] as const) {
            const owner = relation === "owned" ? me : other;
            const event = (
              await createEvent(owner, { name: "E", visibility, voteLicense: license })
            ).body;
            if (relation === "invited") await invite(event.id, me.id);
            cases.push({
              id: event.id,
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
          `/events?limit=7${cursor ? `&cursor=${cursor}` : ""}`,
          me,
        );
        response.body.items.forEach((e: { id: string }) => listed.add(e.id));
        cursor = response.body.nextCursor;
      } while (cursor);

      expect(cases).toHaveLength(18);
      for (const { id, label } of cases) {
        const loaded = await loadEventAccess(pool, id, me.id);
        const byEngine = canView(loaded!.resource, loaded!.subject);
        const byGet = (await call("get", `/events/${id}`, me)).status === 200;
        expect({ label, listed: listed.has(id), get: byGet }).toEqual({
          label,
          listed: byEngine,
          get: byEngine,
        });
      }
    });
  });

  describe("PATCH /events/{id}", () => {
    it("lets the owner change the name, the visibility and the license", async () => {
      const owner = await makeUser("owner");
      const { body: event } = await createEvent(owner);

      const renamed = await call("patch", `/events/${event.id}`, owner).send({
        name: "Renamed",
      });
      const hidden = await call("patch", `/events/${event.id}`, owner).send({
        visibility: "private",
      });
      const restricted = await call("patch", `/events/${event.id}`, owner).send({
        voteLicense: locationTime,
      });

      expect(renamed.body).toMatchObject({ name: "Renamed", visibility: "public" });
      expect(hidden.body).toMatchObject({ name: "Renamed", visibility: "private" });
      expect(restricted.body).toMatchObject({
        visibility: "private",
        voteLicense: locationTime,
      });
    });

    it("clears the location columns when the license goes back to something simple", async () => {
      const owner = await makeUser("owner");
      const { body: event } = await createEvent(owner, {
        name: "E",
        voteLicense: locationTime,
      });

      const response = await call("patch", `/events/${event.id}`, owner).send({
        voteLicense: { type: "invited_only" },
      });

      expect(response.status).toBe(200);
      const row = await pool.query("SELECT * FROM events WHERE id = $1", [event.id]);
      expect(row.rows[0]).toMatchObject({
        vote_license: "invited_only",
        latitude: null,
        longitude: null,
        radius_meters: null,
        starts_at: null,
        ends_at: null,
      });
    });

    it("never changes the owner or the creation date", async () => {
      const owner = await makeUser("owner");
      const { body: event } = await createEvent(owner);

      const response = await call("patch", `/events/${event.id}`, owner).send({
        name: "New",
      });

      expect(response.body.ownerId).toBe(owner.id);
      expect(response.body.createdAt).toBe(event.createdAt);
    });

    it("refuses a visible event's non-owner with 403 and changes nothing", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const { body: event } = await createEvent(owner);

      const response = await call("patch", `/events/${event.id}`, stranger).send({
        name: "Hacked",
      });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect((await call("get", `/events/${event.id}`, owner)).body.name).toBe("Friday");
    });

    it("refuses an invited non-owner with 403, and a hidden event with 404", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const stranger = await makeUser("stranger");
      const { body: event } = await createEvent(owner, {
        name: "E",
        visibility: "private",
      });
      await invite(event.id, guest.id);

      expect(
        (await call("patch", `/events/${event.id}`, guest).send({ name: "x" })).status,
      ).toBe(403);
      expect(
        (await call("patch", `/events/${event.id}`, stranger).send({ name: "x" })).status,
      ).toBe(404);
    });

    it("answers 404 for an event that does not exist", async () => {
      const user = await makeUser("user");

      expect(
        (await call("patch", `/events/${MISSING_UUID}`, user).send({ name: "x" })).status,
      ).toBe(404);
    });

    it.each([
      ["an empty body", {}],
      ["an unknown field", { color: "red" }],
      ["an owner change", { ownerId: "x" }],
      ["a blank name", { name: "" }],
      ["an invalid license", { voteLicense: { type: "location_time" } }],
    ])("answers 400 for %s", async (_label, body) => {
      const owner = await makeUser("owner");
      const { body: event } = await createEvent(owner);

      const response = await call("patch", `/events/${event.id}`, owner).send(body);

      expect(response.status).toBe(400);
    });

    it("applies simultaneous changes to different fields without losing any", async () => {
      const owner = await makeUser("owner");
      for (let round = 0; round < 10; round++) {
        const { body: event } = await createEvent(owner, { name: "start" });

        const responses = await Promise.all([
          call("patch", `/events/${event.id}`, owner).send({ name: `name-${round}` }),
          call("patch", `/events/${event.id}`, owner).send({ visibility: "private" }),
          call("patch", `/events/${event.id}`, owner).send({
            voteLicense: { type: "invited_only" },
          }),
        ]);

        expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
        const final = (await call("get", `/events/${event.id}`, owner)).body;
        expect(final).toMatchObject({
          name: `name-${round}`,
          visibility: "private",
          voteLicense: { type: "invited_only" },
        });
      }
    });
  });

  describe("DELETE /events/{id}", () => {
    it("lets the owner delete the event, with its invitations", async () => {
      const owner = await makeUser("owner");
      const guest = await makeUser("guest");
      const { body: event } = await createEvent(owner);
      await invite(event.id, guest.id);

      const response = await call("delete", `/events/${event.id}`, owner);

      expect(response.status).toBe(204);
      expect((await call("get", `/events/${event.id}`, owner)).status).toBe(404);
      const left = await pool.query(
        "SELECT count(*) FROM event_invitations WHERE event_id = $1",
        [event.id],
      );
      expect(Number(left.rows[0].count)).toBe(0);
    });

    it("refuses a non-owner with 403 and keeps the event", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const { body: event } = await createEvent(owner);

      const response = await call("delete", `/events/${event.id}`, stranger);

      expect(response.status).toBe(403);
      expect((await call("get", `/events/${event.id}`, owner)).status).toBe(200);
    });

    it("answers 404 for a hidden event, keeping it", async () => {
      const owner = await makeUser("owner");
      const stranger = await makeUser("stranger");
      const { body: event } = await createEvent(owner, {
        name: "E",
        visibility: "private",
      });

      expect((await call("delete", `/events/${event.id}`, stranger)).status).toBe(404);
      expect((await call("get", `/events/${event.id}`, owner)).status).toBe(200);
    });

    it("answers 404 when the event does not exist or is already deleted", async () => {
      const owner = await makeUser("owner");
      const { body: event } = await createEvent(owner);
      await call("delete", `/events/${event.id}`, owner);

      expect((await call("delete", `/events/${event.id}`, owner)).status).toBe(404);
      expect((await call("delete", `/events/${MISSING_UUID}`, owner)).status).toBe(404);
    });

    it("lets exactly one of two simultaneous deletes succeed", async () => {
      const owner = await makeUser("owner");
      const { body: event } = await createEvent(owner);

      const responses = await Promise.all([
        call("delete", `/events/${event.id}`, owner),
        call("delete", `/events/${event.id}`, owner),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([204, 404]);
    });
  });
});
