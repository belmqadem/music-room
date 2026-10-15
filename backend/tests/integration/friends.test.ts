import type { Express } from "express";
import pg from "pg";
import pino from "pino";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";
import { signAccessToken } from "../../src/modules/auth/access-token.js";
import { areFriends } from "../../src/modules/friends/repository.js";

// Friends (ADR-023) against a real, migrated Postgres (set TEST_DATABASE_URL). Rules under test:
// a request is accepted only by its addressee; one row per pair whichever way it was asked;
// A->B while B->A is pending becomes a friendship; every list and answer is about the caller's own
// relationships; strangers learn nothing; simultaneous requests and accepts cannot break any of it.
const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(32);
// Every test user's name starts with this, so cleanup never touches other data.
const RUN = `friends${Math.random().toString(36).slice(2, 8)}`;

interface TestUser {
  id: string;
  name: string;
  token: string;
}

describe.skipIf(!databaseUrl)("friends", () => {
  let pool: pg.Pool;
  let app: Express;

  beforeAll(() => {
    pool = createPostgresPool(databaseUrl!);
    app = buildApp();
  });
  afterEach(async () => {
    await pool.query("DELETE FROM users WHERE display_name LIKE $1", [`${RUN}%`]);
  });
  afterAll(async () => {
    await pool.end();
  });

  function buildApp(overrides: Partial<Parameters<typeof createApp>[0]> = {}): Express {
    return createApp({
      pool,
      jwtSecret: SECRET,
      logger: pino({ level: "silent" }),
      friendRequestLimit: { windowMs: 60_000, limit: 10_000 },
      ...overrides,
    });
  }

  async function makeUser(name: string): Promise<TestUser> {
    const { rows } = await pool.query(
      "INSERT INTO users (display_name, email) VALUES ($1, $2) RETURNING id",
      [`${RUN}${name}`, `${RUN}${name}@friends.invalid`],
    );
    const id = rows[0].id as string;
    return { id, name: `${RUN}${name}`, token: await signAccessToken(id, SECRET) };
  }
  const as = (user: TestUser | null, req: request.Test) =>
    user ? req.set("Authorization", `Bearer ${user.token}`) : req;
  const send = (from: TestUser | null, toId: string, target: Express = app) =>
    as(from, request(target).post("/api/v1/friends/requests")).send({ userId: toId });
  const accept = (user: TestUser | null, requestId: string) =>
    as(user, request(app).post(`/api/v1/friends/requests/${requestId}/accept`));
  const removeRequest = (user: TestUser | null, requestId: string) =>
    as(user, request(app).delete(`/api/v1/friends/requests/${requestId}`));
  const requests = (user: TestUser | null, query: string) =>
    as(user, request(app).get(`/api/v1/friends/requests?${query}`));
  const friends = (user: TestUser | null, query = "") =>
    as(user, request(app).get(`/api/v1/friends?${query}`));
  const unfriend = (user: TestUser | null, otherId: string) =>
    as(user, request(app).delete(`/api/v1/friends/${otherId}`));
  const rowCount = async () =>
    Number(
      (
        await pool.query(
          `SELECT count(*) FROM friendships
           WHERE requester_id IN (SELECT id FROM users WHERE display_name LIKE $1)`,
          [`${RUN}%`],
        )
      ).rows[0].count,
    );

  /** Makes two users friends the way the API does. */
  async function befriend(a: TestUser, b: TestUser) {
    const sent = await send(a, b.id);
    expect(sent.status).toBe(201);
    const accepted = await accept(b, sent.body.id);
    expect(accepted.status).toBe(200);
    return sent.body.id as string;
  }

  describe("authentication", () => {
    it.each([
      ["POST", "/friends/requests"],
      ["GET", "/friends/requests?direction=incoming"],
      ["POST", "/friends/requests/11111111-1111-4111-8111-111111111111/accept"],
      ["DELETE", "/friends/requests/11111111-1111-4111-8111-111111111111"],
      ["GET", "/friends"],
      ["DELETE", "/friends/11111111-1111-4111-8111-111111111111"],
    ])("%s %s requires a signed-in user", async (method, path) => {
      const response = await request(app)
        [method.toLowerCase() as "get"](`/api/v1${path}`)
        .send({});

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("sending a request", () => {
    it("creates a pending request, seen as outgoing by the sender and incoming by the other", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");

      const response = await send(ada, bob.id);
      const fromBob = await requests(bob, "direction=incoming");
      const fromAda = await requests(ada, "direction=outgoing");

      expect(response.status).toBe(201);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        user: { id: bob.id, displayName: bob.name },
        status: "pending",
        direction: "outgoing",
        createdAt: expect.any(String),
        respondedAt: null,
      });
      expect(fromBob.body.items).toEqual([
        {
          ...response.body,
          user: { id: ada.id, displayName: ada.name },
          direction: "incoming",
        },
      ]);
      expect(fromAda.body.items).toEqual([response.body]);
    });

    it("never shows an email, in the answer or the lists", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      const sent = await send(ada, bob.id);

      const text = JSON.stringify([
        sent.body,
        (await requests(bob, "direction=incoming")).body,
      ]);

      expect(text).not.toContain("@");
      expect(text.toLowerCase()).not.toContain("email");
    });

    it("refuses a request to yourself (400) and writes nothing", async () => {
      const ada = await makeUser("-ada");

      const response = await send(ada, ada.id);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(await rowCount()).toBe(0);
    });

    it("answers 404 USER_NOT_FOUND for a user that does not exist", async () => {
      const ada = await makeUser("-ada");

      const response = await send(ada, "11111111-1111-4111-8111-111111111111");

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("USER_NOT_FOUND");
    });

    it.each([
      ["a user id that is not a UUID", { userId: "nope" }],
      ["no user id", {}],
      [
        "an unknown field",
        { userId: "11111111-1111-4111-8111-111111111111", status: "accepted" },
      ],
    ])("answers 400 VALIDATION_ERROR for %s", async (_label, body) => {
      const ada = await makeUser("-ada");

      const response = await as(ada, request(app).post("/api/v1/friends/requests")).send(
        body,
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("answers 409 FRIEND_REQUEST_EXISTS when you already asked", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      await send(ada, bob.id);

      const again = await send(ada, bob.id);

      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("FRIEND_REQUEST_EXISTS");
      expect(await rowCount()).toBe(1);
    });

    it("answers 409 ALREADY_FRIENDS from either side once they are friends", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      await befriend(ada, bob);

      const fromAda = await send(ada, bob.id);
      const fromBob = await send(bob, ada.id);

      expect(fromAda.status).toBe(409);
      expect(fromAda.body.error.code).toBe("ALREADY_FRIENDS");
      expect(fromBob.status).toBe(409);
      expect(fromBob.body.error.code).toBe("ALREADY_FRIENDS");
    });

    it("turns A->B into a friendship when B->A is already pending (200, not 201)", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      const first = await send(ada, bob.id);

      const reply = await send(bob, ada.id);

      expect(reply.status).toBe(200);
      expect(reply.body).toMatchObject({
        id: first.body.id,
        status: "accepted",
        // The row is Ada's request, so from Bob's side it is still the one he received.
        direction: "incoming",
        user: { id: ada.id },
      });
      expect(reply.body.respondedAt).not.toBeNull();
      expect(
        (await friends(ada)).body.items.map((f: { user: { id: string } }) => f.user.id),
      ).toEqual([bob.id]);
      expect(
        (await friends(bob)).body.items.map((f: { user: { id: string } }) => f.user.id),
      ).toEqual([ada.id]);
      expect((await requests(bob, "direction=incoming")).body.items).toEqual([]);
      expect(await rowCount()).toBe(1);
    });

    it("keeps ONE row when A->B and B->A are sent at the same moment, and ends with a friendship", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");

      const [fromAda, fromBob] = await Promise.all([
        send(ada, bob.id),
        send(bob, ada.id),
      ]);

      expect([fromAda.status, fromBob.status].sort()).toEqual([200, 201]);
      expect(await rowCount()).toBe(1);
      expect((await friends(ada)).body.items).toHaveLength(1);
    });

    it("lets exactly one of 10 simultaneous identical requests create the row", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");

      const responses = await Promise.all(
        Array.from({ length: 10 }, () => send(ada, bob.id)),
      );

      const statuses = responses.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
      expect(await rowCount()).toBe(1);
    });

    it("is rate limited", async () => {
      const limited = buildApp({ friendRequestLimit: { windowMs: 60_000, limit: 2 } });
      const ada = await makeUser("-ada");
      const people = await Promise.all([
        makeUser("-b1"),
        makeUser("-b2"),
        makeUser("-b3"),
      ]);

      const statuses = [];
      for (const person of people)
        statuses.push((await send(ada, person.id, limited)).status);

      expect(statuses).toEqual([201, 201, 429]);
    });
  });

  describe("accepting", () => {
    it("lets the addressee accept: a friendship for both", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      const sent = await send(ada, bob.id);

      const response = await accept(bob, sent.body.id);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: sent.body.id,
        status: "accepted",
        direction: "incoming",
        user: { id: ada.id, displayName: ada.name },
      });
      expect(response.body.respondedAt).not.toBeNull();
      expect(await areFriends(pool, ada.id, bob.id)).toBe(true);
      expect(await areFriends(pool, bob.id, ada.id)).toBe(true);
    });

    it("does NOT let the requester accept their own request (403), which stays pending", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      const sent = await send(ada, bob.id);

      const response = await accept(ada, sent.body.id);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(await areFriends(pool, ada.id, bob.id)).toBe(false);
    });

    it("answers a stranger exactly like an unknown id (404), and changes nothing", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      const eve = await makeUser("-eve");
      const sent = await send(ada, bob.id);

      const stranger = await accept(eve, sent.body.id);
      const unknown = await accept(eve, "11111111-1111-4111-8111-111111111111");

      expect(stranger.status).toBe(404);
      expect(stranger.body).toEqual(unknown.body);
      expect(stranger.body.error.code).toBe("FRIENDSHIP_NOT_FOUND");
      expect(await areFriends(pool, ada.id, bob.id)).toBe(false);
    });

    it("answers 409 ALREADY_FRIENDS when accepted twice", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      const id = await befriend(ada, bob);

      const again = await accept(bob, id);

      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("ALREADY_FRIENDS");
    });

    it("lets exactly one of 10 simultaneous accepts win", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      const sent = await send(ada, bob.id);

      const responses = await Promise.all(
        Array.from({ length: 10 }, () => accept(bob, sent.body.id)),
      );

      expect(responses.map((r) => r.status).sort()).toEqual([
        200, 409, 409, 409, 409, 409, 409, 409, 409, 409,
      ]);
    });

    it("answers 400 for an id that is not a UUID", async () => {
      const ada = await makeUser("-ada");

      const response = await accept(ada, "not-a-uuid");

      expect(response.status).toBe(400);
    });
  });

  describe("declining and cancelling", () => {
    it("lets the addressee decline (204): the row is gone and a new request can be sent", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      const sent = await send(ada, bob.id);

      const declined = await removeRequest(bob, sent.body.id);
      const again = await send(ada, bob.id);

      expect(declined.status).toBe(204);
      expect(again.status).toBe(201);
      expect(await rowCount()).toBe(1);
    });

    it("lets the requester cancel (204)", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      const sent = await send(ada, bob.id);

      const cancelled = await removeRequest(ada, sent.body.id);

      expect(cancelled.status).toBe(204);
      expect(await rowCount()).toBe(0);
    });

    it("does not let a stranger remove it (404), and the request stays", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      const eve = await makeUser("-eve");
      const sent = await send(ada, bob.id);

      const response = await removeRequest(eve, sent.body.id);

      expect(response.status).toBe(404);
      expect(await rowCount()).toBe(1);
    });

    it("cannot be used to unfriend: an accepted friendship is not a request (404)", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      const id = await befriend(ada, bob);

      const response = await removeRequest(ada, id);

      expect(response.status).toBe(404);
      expect(await areFriends(pool, ada.id, bob.id)).toBe(true);
    });
  });

  describe("listing requests", () => {
    it("needs a direction", async () => {
      const ada = await makeUser("-ada");

      const response = await requests(ada, "");

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("keeps incoming and outgoing apart, and leaves accepted friendships out", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      const cy = await makeUser("-cy");
      const dee = await makeUser("-dee");
      await send(ada, bob.id); // outgoing, pending
      await send(cy, ada.id); // incoming, pending
      await befriend(dee, ada); // accepted: in neither list

      const incoming = await requests(ada, "direction=incoming");
      const outgoing = await requests(ada, "direction=outgoing");

      expect(incoming.body.items.map((r: { user: { id: string } }) => r.user.id)).toEqual(
        [cy.id],
      );
      expect(outgoing.body.items.map((r: { user: { id: string } }) => r.user.id)).toEqual(
        [bob.id],
      );
    });

    it("pages through every request once, newest first", async () => {
      const ada = await makeUser("-ada");
      const others = await Promise.all([1, 2, 3, 4, 5].map((n) => makeUser(`-o${n}`)));
      for (const other of others) await send(other, ada.id);

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: string = `direction=incoming&limit=2${cursor ? `&cursor=${cursor}` : ""}`;
        const page = await requests(ada, query);
        expect(page.status).toBe(200);
        seen.push(...page.body.items.map((r: { user: { id: string } }) => r.user.id));
        cursor = page.body.nextCursor;
        pages++;
      } while (cursor);

      expect(pages).toBe(3);
      expect(seen).toEqual(others.map((o) => o.id).reverse());
    });

    it("answers 400 for a cursor that is not ours", async () => {
      const ada = await makeUser("-ada");

      const response = await requests(ada, "direction=incoming&cursor=garbage");

      expect(response.status).toBe(400);
    });
  });

  describe("listing friends and unfriending", () => {
    it("shows each side the other, newest friendship first, and only the caller's own", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      const cy = await makeUser("-cy");
      const eve = await makeUser("-eve");
      await befriend(ada, bob);
      await befriend(cy, ada); // asked the other way round, later
      await send(eve, ada.id); // pending: not a friend yet

      const mine = await friends(ada);
      const theirs = await friends(bob);
      const strangers = await friends(eve);

      expect(mine.body.items.map((f: { user: { id: string } }) => f.user.id)).toEqual([
        cy.id,
        bob.id,
      ]);
      expect(
        mine.body.items.every((f: { status: string }) => f.status === "accepted"),
      ).toBe(true);
      expect(theirs.body.items.map((f: { user: { id: string } }) => f.user.id)).toEqual([
        ada.id,
      ]);
      expect(strangers.body.items).toEqual([]);
    });

    it("pages through every friend once", async () => {
      const ada = await makeUser("-ada");
      const others = await Promise.all([1, 2, 3, 4, 5].map((n) => makeUser(`-f${n}`)));
      for (const other of others) await befriend(ada, other);

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await friends(ada, `limit=2${cursor ? `&cursor=${cursor}` : ""}`);
        seen.push(...page.body.items.map((f: { user: { id: string } }) => f.user.id));
        cursor = page.body.nextCursor;
      } while (cursor);

      expect(seen).toEqual(others.map((o) => o.id).reverse());
    });

    it("lets either side unfriend (204), for both", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      await befriend(ada, bob);

      const response = await unfriend(bob, ada.id);

      expect(response.status).toBe(204);
      expect(await areFriends(pool, ada.id, bob.id)).toBe(false);
      expect((await friends(ada)).body.items).toEqual([]);
    });

    it("answers 404 when you are not friends, and does not remove a pending request", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      await send(ada, bob.id);

      const response = await unfriend(ada, bob.id);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("FRIENDSHIP_NOT_FOUND");
      expect(await rowCount()).toBe(1);
    });

    it("cannot remove a friendship between two OTHER people", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      const cy = await makeUser("-cy");
      await befriend(bob, cy);

      const viaAda = await unfriend(ada, bob.id);
      const viaAdaToCy = await unfriend(ada, cy.id);

      expect(viaAda.status).toBe(404);
      expect(viaAdaToCy.status).toBe(404);
      expect(await areFriends(pool, bob.id, cy.id)).toBe(true);
    });
  });

  describe("the database", () => {
    it("refuses a friendship with yourself", async () => {
      const ada = await makeUser("-ada");

      await expect(
        pool.query(
          "INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $1)",
          [ada.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("refuses a second row for the same pair, in either direction", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      await pool.query(
        "INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2)",
        [ada.id, bob.id],
      );

      await expect(
        pool.query(
          "INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2)",
          [bob.id, ada.id],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    });

    it("keeps status and responded_at consistent", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");

      await expect(
        pool.query(
          "INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'accepted')",
          [ada.id, bob.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("removes a user's friendships when the user is deleted", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      await befriend(ada, bob);

      await pool.query("DELETE FROM users WHERE id = $1", [ada.id]);

      expect(await rowCount()).toBe(0);
      expect((await friends(bob)).body.items).toEqual([]);
    });

    it("areFriends is false for a pending request and for strangers", async () => {
      const ada = await makeUser("-ada");
      const bob = await makeUser("-bob");
      const cy = await makeUser("-cy");
      await send(ada, bob.id);

      expect(await areFriends(pool, ada.id, bob.id)).toBe(false);
      expect(await areFriends(pool, ada.id, cy.id)).toBe(false);
    });
  });
});
