import type { Express } from "express";
import pg from "pg";
import pino from "pino";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";
import { signAccessToken } from "../../src/modules/auth/access-token.js";

// Profiles (ADR-024) against a real, migrated Postgres (set TEST_DATABASE_URL). Rules under test:
// the server alone decides who sees which block (owner / accepted friend / other signed-in user),
// a pending request is not friendship, a hidden block is omitted, only the owner can edit and only
// their own profile, and PATCH changes just what it was sent.
const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(32);
const RUN = `prof${Math.random().toString(36).slice(2, 8)}`;

interface TestUser {
  id: string;
  name: string;
  token: string;
}

const FULL = {
  publicInfo: { bio: "I like bass" },
  friendsInfo: { fullName: "Ana Smith", city: "Lyon" },
  privateInfo: { phone: "+33 6 11 22 33 44", birthDate: "1990-05-17" },
  musicPreferences: { genres: ["Rock", "jazz"] },
};

describe.skipIf(!databaseUrl)("profiles", () => {
  let pool: pg.Pool;
  let app: Express;

  beforeAll(() => {
    pool = createPostgresPool(databaseUrl!);
    app = createApp({ pool, jwtSecret: SECRET, logger: pino({ level: "silent" }) });
  });
  afterEach(async () => {
    await pool.query("DELETE FROM users WHERE display_name LIKE $1", [`${RUN}%`]);
  });
  afterAll(async () => {
    await pool.end();
  });

  async function makeUser(name: string): Promise<TestUser> {
    const { rows } = await pool.query(
      "INSERT INTO users (display_name, email) VALUES ($1, $2) RETURNING id",
      [`${RUN}${name}`, `${RUN}${name}@profiles.invalid`],
    );
    const id = rows[0].id as string;
    return {
      id,
      name: `${RUN}${name}`,
      token: await signAccessToken(id, SECRET, { displayNameSet: true }),
    };
  }
  const as = (user: TestUser | null, req: request.Test) =>
    user ? req.set("Authorization", `Bearer ${user.token}`) : req;
  const getOwn = (user: TestUser | null) =>
    as(user, request(app).get("/api/v1/users/me/profile"));
  const patch = (user: TestUser | null, body: unknown) =>
    as(user, request(app).patch("/api/v1/users/me/profile")).send(body as object);
  const getOf = (user: TestUser | null, id: string) =>
    as(user, request(app).get(`/api/v1/users/${id}/profile`));
  const befriend = (a: TestUser, b: TestUser, status = "accepted") =>
    pool.query(
      `INSERT INTO friendships (requester_id, addressee_id, status, responded_at)
       VALUES ($1, $2, $3, CASE WHEN $3 = 'accepted' THEN now() END)`,
      [a.id, b.id, status],
    );

  async function ownerWithFullProfile() {
    const owner = await makeUser("owner");
    const res = await patch(owner, FULL);
    expect(res.status).toBe(200);
    return owner;
  }

  describe("authentication", () => {
    it("requires a token on all three endpoints", async () => {
      const someone = await makeUser("someone");
      expect((await getOwn(null)).status).toBe(401);
      expect((await patch(null, {})).status).toBe(401);
      expect((await getOf(null, someone.id)).status).toBe(401);
    });
  });

  describe("visibility matrix", () => {
    it("shows the owner every block", async () => {
      const owner = await ownerWithFullProfile();
      const res = await getOwn(owner);
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body).toEqual({
        userId: owner.id,
        displayName: owner.name,
        publicInfo: { bio: "I like bass" },
        friendsInfo: { fullName: "Ana Smith", city: "Lyon" },
        musicPreferences: { genres: ["rock", "jazz"] },
        privateInfo: { phone: "+33 6 11 22 33 44", birthDate: "1990-05-17" },
        friendship: null,
      });
    });

    it("the owner reading /users/{ownId}/profile gets the same as /me", async () => {
      const owner = await ownerWithFullProfile();
      expect((await getOf(owner, owner.id)).body).toEqual((await getOwn(owner)).body);
    });

    it("shows an accepted friend everything but the private block, in either direction", async () => {
      const owner = await ownerWithFullProfile();
      for (const [requester, addressee] of [
        ["asked", "owner"],
        ["owner", "asked"],
      ] as const) {
        const friend = await makeUser(`friend${requester}`);
        await (requester === "owner" ? befriend(owner, friend) : befriend(friend, owner));
        void addressee;
        const res = await getOf(friend, owner.id);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          userId: owner.id,
          displayName: owner.name,
          publicInfo: { bio: "I like bass" },
          friendsInfo: { fullName: "Ana Smith", city: "Lyon" },
          musicPreferences: { genres: ["rock", "jazz"] },
          friendship: {
            id: expect.any(String),
            status: "accepted",
            direction: requester === "owner" ? "incoming" : "outgoing",
          },
        });
        // The full values, not fragments: a random user id in the same JSON can contain "1990".
        expect(JSON.stringify(res.body)).not.toContain("+33 6 11 22 33 44");
        expect(JSON.stringify(res.body)).not.toContain("1990-05-17");
      }
    });

    it("shows another signed-in user the public block only", async () => {
      const owner = await ownerWithFullProfile();
      const stranger = await makeUser("stranger");
      const res = await getOf(stranger, owner.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId: owner.id,
        displayName: owner.name,
        publicInfo: { bio: "I like bass" },
        friendship: null,
      });
      const text = JSON.stringify(res.body);
      for (const hidden of [
        "Ana Smith",
        "Lyon",
        "+33 6 11 22 33 44",
        "1990-05-17",
        "genres",
      ]) {
        expect(text).not.toContain(hidden);
      }
    });

    it("a pending request, in either direction, is not friendship", async () => {
      const owner = await ownerWithFullProfile();
      const sent = await makeUser("sent");
      const received = await makeUser("received");
      await befriend(sent, owner, "pending");
      await befriend(owner, received, "pending");
      for (const caller of [sent, received]) {
        const res = await getOf(caller, owner.id);
        expect(Object.keys(res.body).sort()).toEqual([
          "displayName",
          "friendship",
          "publicInfo",
          "userId",
        ]);
      }
    });

    it("friendship is not transitive and is not with a third party", async () => {
      const owner = await ownerWithFullProfile();
      const friend = await makeUser("friend");
      const friendOfFriend = await makeUser("fof");
      await befriend(owner, friend);
      await befriend(friend, friendOfFriend);
      const res = await getOf(friendOfFriend, owner.id);
      expect(res.body.friendsInfo).toBeUndefined();
    });

    it("loses friends-only access as soon as the friendship ends", async () => {
      const owner = await ownerWithFullProfile();
      const friend = await makeUser("friend");
      await befriend(owner, friend);
      expect((await getOf(friend, owner.id)).body.friendsInfo).toBeDefined();
      // Only this pair: other test files use the same database at the same time.
      await pool.query(
        "DELETE FROM friendships WHERE requester_id = $1 AND addressee_id = $2",
        [owner.id, friend.id],
      );
      expect((await getOf(friend, owner.id)).body.friendsInfo).toBeUndefined();
    });

    it("a user who never edited has an empty profile, visible per the same rules", async () => {
      const blank = await makeUser("blank");
      const friend = await makeUser("friend");
      await befriend(blank, friend);
      expect((await getOwn(blank)).body).toEqual({
        userId: blank.id,
        displayName: blank.name,
        publicInfo: { bio: null },
        friendsInfo: { fullName: null, city: null },
        musicPreferences: { genres: [] },
        privateInfo: { phone: null, birthDate: null },
        friendship: null,
      });
      const stranger = await makeUser("stranger");
      expect((await getOf(stranger, blank.id)).body).toEqual({
        userId: blank.id,
        displayName: blank.name,
        publicInfo: { bio: null },
        friendship: null,
      });
      expect((await getOf(friend, blank.id)).body.privateInfo).toBeUndefined();
    });
  });

  describe("where the caller stands with the owner (ADR-042)", () => {
    const pairId = async (a: TestUser, b: TestUser) =>
      (
        await pool.query(
          `SELECT id FROM friendships
           WHERE (requester_id = $1 AND addressee_id = $2)
              OR (requester_id = $2 AND addressee_id = $1)`,
          [a.id, b.id],
        )
      ).rows[0].id as string;

    it("a request you sent is pending and outgoing, with the request's id", async () => {
      const owner = await makeUser("owner");
      const asker = await makeUser("asker");
      await befriend(asker, owner, "pending");
      expect((await getOf(asker, owner.id)).body.friendship).toEqual({
        id: await pairId(asker, owner),
        status: "pending",
        direction: "outgoing",
      });
    });

    it("a request you received is pending and incoming, with the same id", async () => {
      const owner = await makeUser("owner");
      const asker = await makeUser("asker");
      await befriend(owner, asker, "pending");
      expect((await getOf(asker, owner.id)).body.friendship).toEqual({
        id: await pairId(asker, owner),
        status: "pending",
        direction: "incoming",
      });
    });

    it("someone else's request or friendship never shows on your view", async () => {
      const owner = await makeUser("owner");
      const friend = await makeUser("friend");
      const other = await makeUser("other");
      await befriend(owner, friend);
      await befriend(other, friend, "pending");
      expect((await getOf(other, owner.id)).body.friendship).toBeNull();
    });

    it("follows the row: gone after unfriending, null on your own profile and after PATCH", async () => {
      const owner = await makeUser("owner");
      const friend = await makeUser("friend");
      await befriend(owner, friend);
      expect((await getOf(friend, owner.id)).body.friendship.status).toBe("accepted");
      await pool.query("DELETE FROM friendships WHERE id = $1", [
        await pairId(owner, friend),
      ]);
      expect((await getOf(friend, owner.id)).body.friendship).toBeNull();
      expect((await getOf(owner, owner.id)).body.friendship).toBeNull();
      expect(
        (await patch(owner, { publicInfo: { bio: "hi" } })).body.friendship,
      ).toBeNull();
    });
  });

  describe("unknown and malformed ids", () => {
    it("answers 404 USER_NOT_FOUND for an unknown user", async () => {
      const caller = await makeUser("caller");
      const res = await getOf(caller, "00000000-0000-4000-8000-000000000000");
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("USER_NOT_FOUND");
    });

    it("answers 400 for an id that is not a UUID", async () => {
      const caller = await makeUser("caller");
      expect((await getOf(caller, "nope")).status).toBe(400);
    });
  });

  describe("editing", () => {
    it("only ever edits the caller's own profile", async () => {
      const victim = await ownerWithFullProfile();
      const attacker = await makeUser("attacker");
      // There is no id in the path; an id in the body is an unknown field.
      const res = await patch(attacker, {
        userId: victim.id,
        publicInfo: { bio: "pwned" },
      });
      expect(res.status).toBe(400);
      expect((await patch(attacker, { publicInfo: { bio: "mine" } })).status).toBe(200);
      expect((await getOwn(victim)).body.publicInfo.bio).toBe("I like bass");
      expect((await getOwn(attacker)).body.publicInfo.bio).toBe("mine");
    });

    it("changes only the fields that were sent", async () => {
      const owner = await ownerWithFullProfile();
      const res = await patch(owner, { friendsInfo: { city: "Nice" } });
      expect(res.status).toBe(200);
      expect(res.body.friendsInfo).toEqual({ fullName: "Ana Smith", city: "Nice" });
      expect(res.body.publicInfo.bio).toBe("I like bass");
      expect(res.body.privateInfo.phone).toBe("+33 6 11 22 33 44");
      expect(res.body.musicPreferences.genres).toEqual(["rock", "jazz"]);
    });

    it("clears a field with null and a list with an empty array", async () => {
      const owner = await ownerWithFullProfile();
      const res = await patch(owner, {
        publicInfo: { bio: null },
        privateInfo: { birthDate: null },
        musicPreferences: { genres: [] },
      });
      expect(res.body.publicInfo.bio).toBeNull();
      expect(res.body.privateInfo).toEqual({
        phone: "+33 6 11 22 33 44",
        birthDate: null,
      });
      expect(res.body.musicPreferences.genres).toEqual([]);
    });

    it("replaces the whole genre list and normalises it", async () => {
      const owner = await ownerWithFullProfile();
      const res = await patch(owner, {
        musicPreferences: { genres: [" Metal ", "METAL", "Folk"] },
      });
      expect(res.body.musicPreferences.genres).toEqual(["metal", "folk"]);
    });

    it("an empty PATCH changes nothing and returns the profile", async () => {
      const owner = await ownerWithFullProfile();
      const before = (await getOwn(owner)).body;
      const res = await patch(owner, {});
      expect(res.status).toBe(200);
      expect(res.body).toEqual(before);
    });

    it("an empty PATCH on a user without a row creates no row", async () => {
      const owner = await makeUser("blank");
      expect((await patch(owner, {})).status).toBe(200);
      const { rowCount } = await pool.query("SELECT 1 FROM profiles WHERE user_id = $1", [
        owner.id,
      ]);
      expect(rowCount).toBe(0);
    });

    it("rejects invalid values with 400 and changes nothing", async () => {
      const owner = await ownerWithFullProfile();
      const before = (await getOwn(owner)).body;
      const bad = [
        { publicInfo: { bio: "a".repeat(281) } },
        { friendsInfo: { fullName: "a".repeat(81) } },
        { privateInfo: { phone: "not a phone" } },
        { privateInfo: { birthDate: "2999-01-01" } },
        { musicPreferences: { genres: Array.from({ length: 11 }, (_, i) => `g${i}`) } },
        { publicInfo: { bio: "ok" }, privateInfo: { phone: "bad!" } },
        { publicInfo: "text" },
      ];
      for (const body of bad) {
        const res = await patch(owner, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
      }
      expect((await getOwn(owner)).body).toEqual(before);
    });

    it("accepts a boundary-length bio and emoji text", async () => {
      const owner = await makeUser("owner");
      const bio = "é".repeat(280);
      expect((await patch(owner, { publicInfo: { bio } })).body.publicInfo.bio).toBe(bio);
    });

    it("stores text as text: markup comes back unchanged", async () => {
      const owner = await makeUser("owner");
      const res = await patch(owner, {
        publicInfo: { bio: "<img src=x onerror=1>' OR 1=1 --" },
      });
      expect(res.body.publicInfo.bio).toBe("<img src=x onerror=1>' OR 1=1 --");
    });

    it("simultaneous first PATCHes on different fields both succeed and neither is lost", async () => {
      const owner = await makeUser("owner");
      const results = await Promise.all([
        patch(owner, { publicInfo: { bio: "bio" } }),
        patch(owner, { friendsInfo: { city: "Rome" } }),
        patch(owner, { musicPreferences: { genres: ["pop"] } }),
        patch(owner, { privateInfo: { phone: "+3912345" } }),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      const final = (await getOwn(owner)).body;
      expect(final.publicInfo.bio).toBe("bio");
      expect(final.friendsInfo.city).toBe("Rome");
      expect(final.musicPreferences.genres).toEqual(["pop"]);
      expect(final.privateInfo.phone).toBe("+3912345");
    });
  });

  it("deleting a user deletes their profile", async () => {
    const owner = await ownerWithFullProfile();
    await pool.query("DELETE FROM users WHERE id = $1", [owner.id]);
    const { rowCount } = await pool.query("SELECT 1 FROM profiles WHERE user_id = $1", [
      owner.id,
    ]);
    expect(rowCount).toBe(0);
  });
});
