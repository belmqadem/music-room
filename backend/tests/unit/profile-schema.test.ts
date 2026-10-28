import { describe, expect, it } from "vitest";
import { updateProfileSchema } from "../../src/modules/profiles/schema.js";
import type { FriendshipRecord } from "../../src/modules/friends/repository.js";
import {
  friendshipOf,
  relationOf,
  shapeProfile,
  type ProfileRecord,
} from "../../src/modules/profiles/visibility.js";

const parse = (body: unknown) => updateProfileSchema.safeParse(body);

describe("updateProfileSchema", () => {
  it("accepts an empty body and every block on its own", () => {
    expect(parse({}).success).toBe(true);
    expect(parse({ publicInfo: { bio: "hi" } }).success).toBe(true);
    expect(parse({ privateInfo: { phone: "+33 6 12 34 56 78" } }).success).toBe(true);
  });

  it("rejects unknown fields at every level", () => {
    expect(parse({ userId: "x" }).success).toBe(false);
    expect(parse({ publicInfo: { bio: "a", extra: 1 } }).success).toBe(false);
    expect(parse({ visibility: "public" }).success).toBe(false);
  });

  it("trims text, turns blank into null and keeps explicit null", () => {
    const parsed = parse({
      publicInfo: { bio: "  hello  " },
      friendsInfo: { city: "   ", fullName: null },
    });
    expect(parsed.data).toEqual({
      publicInfo: { bio: "hello" },
      friendsInfo: { city: null, fullName: null },
    });
  });

  it("enforces the length limits after trimming", () => {
    expect(parse({ publicInfo: { bio: "a".repeat(280) } }).success).toBe(true);
    expect(parse({ publicInfo: { bio: "a".repeat(281) } }).success).toBe(false);
    expect(parse({ friendsInfo: { fullName: "a".repeat(81) } }).success).toBe(false);
    expect(parse({ friendsInfo: { city: "a".repeat(81) } }).success).toBe(false);
    expect(parse({ publicInfo: { bio: ` ${"a".repeat(280)} ` } }).success).toBe(true);
  });

  it("validates phone numbers", () => {
    for (const ok of ["+33612345678", "06 12 34 56 78", "(555) 123-4567"]) {
      expect(parse({ privateInfo: { phone: ok } }).success).toBe(true);
    }
    for (const bad of ["abc", "12", "+".repeat(5), "1".repeat(31), "<script>"]) {
      expect(parse({ privateInfo: { phone: bad } }).success).toBe(false);
    }
  });

  it("validates birth dates: real, not in the future, not before 1900", () => {
    expect(parse({ privateInfo: { birthDate: "1999-12-31" } }).success).toBe(true);
    expect(parse({ privateInfo: { birthDate: "1999-02-30" } }).success).toBe(false);
    expect(parse({ privateInfo: { birthDate: "1899-12-31" } }).success).toBe(false);
    expect(parse({ privateInfo: { birthDate: "2999-01-01" } }).success).toBe(false);
    expect(parse({ privateInfo: { birthDate: "31/12/1999" } }).success).toBe(false);
  });

  it("normalises genres: trimmed, lowercased, deduplicated, at most 10 of at most 30 characters", () => {
    expect(
      parse({ musicPreferences: { genres: [" Rock ", "rock", "Hip-Hop"] } }).data,
    ).toEqual({
      musicPreferences: { genres: ["rock", "hip-hop"] },
    });
    expect(parse({ musicPreferences: { genres: [] } }).success).toBe(true);
    expect(parse({ musicPreferences: { genres: ["a".repeat(31)] } }).success).toBe(false);
    expect(parse({ musicPreferences: { genres: [""] } }).success).toBe(false);
    expect(parse({ musicPreferences: { genres: ["<b>"] } }).success).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, i) => `genre${i}`);
    expect(parse({ musicPreferences: { genres: eleven } }).success).toBe(false);
    expect(parse({ musicPreferences: { genres: eleven.slice(0, 10) } }).success).toBe(
      true,
    );
  });
});

describe("shapeProfile", () => {
  const record: ProfileRecord = {
    userId: "u1",
    displayName: "Ana",
    bio: "bio",
    fullName: "Ana Smith",
    city: "Paris",
    phone: "+33600000000",
    birthDate: "1990-01-01",
    genres: ["rock"],
  };

  const pending = { id: "f1", status: "pending", direction: "outgoing" } as const;

  it("shows everything to the owner", () => {
    expect(shapeProfile(record, "self", null)).toEqual({
      userId: "u1",
      displayName: "Ana",
      publicInfo: { bio: "bio" },
      friendsInfo: { fullName: "Ana Smith", city: "Paris" },
      musicPreferences: { genres: ["rock"] },
      privateInfo: { phone: "+33600000000", birthDate: "1990-01-01" },
      friendship: null,
    });
  });

  it("never gives the owner a friendship with themselves, whatever it is passed", () => {
    expect(shapeProfile(record, "self", pending).friendship).toBeNull();
  });

  it("passes the caller's friendship through for anyone else", () => {
    expect(shapeProfile(record, "stranger", pending).friendship).toEqual(pending);
    const accepted = { ...pending, status: "accepted" } as const;
    expect(shapeProfile(record, "friend", accepted).friendship).toEqual(accepted);
  });

  it("shows friends everything except the private block", () => {
    const shaped = shapeProfile(record, "friend", null);
    expect(shaped.friendsInfo).toEqual({ fullName: "Ana Smith", city: "Paris" });
    expect(shaped.musicPreferences).toEqual({ genres: ["rock"] });
    expect("privateInfo" in shaped).toBe(false);
    expect(JSON.stringify(shaped)).not.toContain("+33600000000");
  });

  it("shows strangers the public block only, with no trace of the others", () => {
    const shaped = shapeProfile(record, "stranger", null);
    expect(Object.keys(shaped).sort()).toEqual([
      "displayName",
      "friendship",
      "publicInfo",
      "userId",
    ]);
    const text = JSON.stringify(shaped);
    for (const secret of ["Ana Smith", "Paris", "+33600000000", "1990-01-01", "rock"]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("relationOf and friendshipOf", () => {
  const row = (over: Partial<FriendshipRecord>): FriendshipRecord => ({
    id: "f1",
    requesterId: "ana",
    addresseeId: "bob",
    status: "pending",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    respondedAt: null,
    ...over,
  });
  const accepted = row({
    status: "accepted",
    respondedAt: new Date("2026-10-02T00:00:00Z"),
  });

  it("you are yourself, whatever row is passed", () => {
    expect(relationOf("ana", "ana", null)).toBe("self");
    expect(relationOf("ana", "ana", accepted)).toBe("self");
  });

  it("only an accepted row makes a friend, from either side", () => {
    expect(relationOf("ana", "bob", accepted)).toBe("friend");
    expect(relationOf("bob", "ana", accepted)).toBe("friend");
  });

  it("a pending request, either way, or no row at all, is a stranger", () => {
    expect(relationOf("ana", "bob", row({}))).toBe("stranger");
    expect(relationOf("bob", "ana", row({}))).toBe("stranger");
    expect(relationOf("ana", "bob", null)).toBe("stranger");
  });

  it("no row: no friendship", () => {
    expect(friendshipOf("ana", null)).toBeNull();
  });

  it("the requester sees it outgoing, the addressee incoming, with the row's id and status", () => {
    expect(friendshipOf("ana", row({}))).toEqual({
      id: "f1",
      status: "pending",
      direction: "outgoing",
    });
    expect(friendshipOf("bob", row({}))).toEqual({
      id: "f1",
      status: "pending",
      direction: "incoming",
    });
    expect(friendshipOf("bob", accepted)).toEqual({
      id: "f1",
      status: "accepted",
      direction: "incoming",
    });
  });

  it("carries nothing else: no other user id, no dates", () => {
    expect(Object.keys(friendshipOf("ana", accepted)!).sort()).toEqual([
      "direction",
      "id",
      "status",
    ]);
  });
});
