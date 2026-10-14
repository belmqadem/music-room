import { describe, expect, it } from "vitest";
import {
  createPlaylistSchema,
  inviteSchema,
  listQuerySchema,
  playlistIdSchema,
  updatePlaylistSchema,
} from "../../src/modules/playlist-editor/schema.js";

describe("createPlaylistSchema", () => {
  it("accepts a name alone and trims it", () => {
    expect(createPlaylistSchema.parse({ name: "  Road trip  " })).toEqual({
      name: "Road trip",
    });
  });

  it.each([{ type: "everyone" }, { type: "invited_only" }])(
    "accepts the edit license %j",
    (editLicense) => {
      expect(createPlaylistSchema.parse({ name: "P", editLicense }).editLicense).toEqual(
        editLicense,
      );
    },
  );

  it.each([
    ["no name", {}],
    ["a blank name", { name: "   " }],
    ["a name over 100 characters", { name: "x".repeat(101) }],
    ["a name that is not a string", { name: 42 }],
    ["an unknown visibility", { name: "P", visibility: "secret" }],
    ["an unknown license type", { name: "P", editLicense: { type: "friends" } }],
    ["a license without a type", { name: "P", editLicense: {} }],
    [
      "the event-only location_time license",
      { name: "P", editLicense: { type: "location_time" } },
    ],
    [
      "extra fields on a license",
      { name: "P", editLicense: { type: "everyone", radiusMeters: 5 } },
    ],
    [
      "the event field name voteLicense",
      { name: "P", voteLicense: { type: "everyone" } },
    ],
    ["an owner id (mass assignment)", { name: "P", ownerId: "someone" }],
    ["an id", { name: "P", id: "00000000-0000-4000-8000-000000000000" }],
    ["a version", { name: "P", version: 99 }],
    ["a creation date", { name: "P", createdAt: "2020-01-01T00:00:00Z" }],
  ])("rejects %s", (_label, body) => {
    expect(createPlaylistSchema.safeParse(body).success).toBe(false);
  });

  it("accepts a 100-character name and the private visibility", () => {
    expect(
      createPlaylistSchema.safeParse({ name: "x".repeat(100), visibility: "private" })
        .success,
    ).toBe(true);
  });
});

describe("updatePlaylistSchema", () => {
  it.each([
    { name: "New" },
    { visibility: "private" },
    { editLicense: { type: "invited_only" } },
  ])("accepts a single field %j", (body) => {
    expect(updatePlaylistSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ["an empty object", {}],
    ["an unknown field", { color: "red" }],
    ["an owner id", { ownerId: "x" }],
    ["a version", { version: 5 }],
    ["a location_time license", { editLicense: { type: "location_time" } }],
    ["a blank name", { name: " " }],
  ])("rejects %s", (_label, body) => {
    expect(updatePlaylistSchema.safeParse(body).success).toBe(false);
  });
});

describe("ids, lists and invitations", () => {
  it("accepts only UUIDs as playlist ids", () => {
    expect(
      playlistIdSchema.safeParse("00000000-0000-4000-8000-000000000000").success,
    ).toBe(true);
    for (const bad of ["1", "abc", "", "../etc/passwd"]) {
      expect(playlistIdSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("defaults the limit to 20 and rejects values outside 1 to 100", () => {
    expect(listQuerySchema.parse({}).limit).toBe(20);
    for (const limit of ["0", "101", "abc", "-1", "1.5", ""]) {
      expect(listQuerySchema.safeParse({ limit }).success).toBe(false);
    }
  });

  it("takes only a UUID as the user to invite", () => {
    expect(
      inviteSchema.safeParse({ userId: "00000000-0000-4000-8000-000000000000" }).success,
    ).toBe(true);
    for (const bad of [
      {},
      { userId: "42" },
      { userId: 42 },
      { userId: "00000000-0000-4000-8000-000000000000", role: "admin" },
    ]) {
      expect(inviteSchema.safeParse(bad).success).toBe(false);
    }
  });
});
