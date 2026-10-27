import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../../src/list-cursor.js";
import {
  createEventSchema,
  eventIdSchema,
  listQuerySchema,
  nearbyQuerySchema,
  updateEventSchema,
} from "../../src/modules/track-vote/schema.js";

const locationTime = {
  type: "location_time",
  latitude: 48.8566,
  longitude: 2.3522,
  radiusMeters: 500,
  startsAt: "2026-10-12T18:00:00Z",
  endsAt: "2026-10-12T22:00:00Z",
};

describe("createEventSchema", () => {
  it("accepts a name alone and trims it", () => {
    expect(createEventSchema.parse({ name: "  Friday night  " })).toEqual({
      name: "Friday night",
    });
  });

  it.each([
    { type: "everyone" },
    { type: "invited_only" },
    locationTime,
    {
      ...locationTime,
      startsAt: "2026-10-12T18:00:00+02:00",
      endsAt: "2026-10-12T22:00:00+02:00",
    },
  ])("accepts the vote license %j", (voteLicense) => {
    expect(createEventSchema.parse({ name: "E", voteLicense }).voteLicense).toBeDefined();
  });

  it.each([
    ["no name", {}],
    ["a blank name", { name: "   " }],
    ["a name over 100 characters", { name: "x".repeat(101) }],
    ["a name that is not a string", { name: 42 }],
    ["an unknown visibility", { name: "E", visibility: "secret" }],
    ["an unknown license type", { name: "E", voteLicense: { type: "friends" } }],
    ["a license without a type", { name: "E", voteLicense: {} }],
    [
      "extra fields on a simple license",
      { name: "E", voteLicense: { type: "everyone", radiusMeters: 5 } },
    ],
    ["an owner id (mass assignment)", { name: "E", ownerId: "someone" }],
    ["an id", { name: "E", id: "00000000-0000-4000-8000-000000000000" }],
    ["a creation date", { name: "E", createdAt: "2020-01-01T00:00:00Z" }],
    [
      "location_time without a latitude",
      { name: "E", voteLicense: { ...locationTime, latitude: undefined } },
    ],
    [
      "location_time without a window",
      { name: "E", voteLicense: { ...locationTime, startsAt: undefined } },
    ],
    [
      "a latitude above 90",
      { name: "E", voteLicense: { ...locationTime, latitude: 90.5 } },
    ],
    [
      "a longitude below -180",
      { name: "E", voteLicense: { ...locationTime, longitude: -181 } },
    ],
    ["a radius of 0", { name: "E", voteLicense: { ...locationTime, radiusMeters: 0 } }],
    [
      "a radius above 100 km",
      { name: "E", voteLicense: { ...locationTime, radiusMeters: 100_001 } },
    ],
    [
      "a fractional radius",
      { name: "E", voteLicense: { ...locationTime, radiusMeters: 10.5 } },
    ],
    [
      "a window that ends before it starts",
      { name: "E", voteLicense: { ...locationTime, endsAt: "2026-10-12T17:00:00Z" } },
    ],
    [
      "a window of zero length",
      { name: "E", voteLicense: { ...locationTime, endsAt: locationTime.startsAt } },
    ],
    [
      "a date that is not ISO 8601",
      { name: "E", voteLicense: { ...locationTime, startsAt: "tomorrow" } },
    ],
    [
      "a date without a time zone",
      { name: "E", voteLicense: { ...locationTime, startsAt: "2026-10-12T18:00:00" } },
    ],
    [
      "a string latitude",
      { name: "E", voteLicense: { ...locationTime, latitude: "48.8" } },
    ],
  ])("rejects %s", (_label, body) => {
    expect(createEventSchema.safeParse(body).success).toBe(false);
  });

  it("accepts the extreme valid values", () => {
    const result = createEventSchema.safeParse({
      name: "x".repeat(100),
      voteLicense: {
        ...locationTime,
        latitude: -90,
        longitude: 180,
        radiusMeters: 100_000,
      },
    });

    expect(result.success).toBe(true);
  });
});

describe("updateEventSchema", () => {
  it.each([
    { name: "New" },
    { visibility: "private" },
    { voteLicense: { type: "invited_only" } },
  ])("accepts a single field %j", (body) => {
    expect(updateEventSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ["an empty object", {}],
    ["an unknown field", { color: "red" }],
    ["an owner id", { ownerId: "x" }],
    ["an invalid license", { voteLicense: { type: "location_time" } }],
    ["a blank name", { name: " " }],
  ])("rejects %s", (_label, body) => {
    expect(updateEventSchema.safeParse(body).success).toBe(false);
  });
});

describe("eventIdSchema and listQuerySchema", () => {
  it("accepts only UUIDs as event ids", () => {
    expect(eventIdSchema.safeParse("00000000-0000-4000-8000-000000000000").success).toBe(
      true,
    );
    for (const bad of ["1", "abc", "", "../etc/passwd", "0000-0000"]) {
      expect(eventIdSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("defaults the limit to 20 and coerces it from the query string", () => {
    expect(listQuerySchema.parse({}).limit).toBe(20);
    expect(listQuerySchema.parse({ limit: "5" }).limit).toBe(5);
  });

  it.each(["0", "101", "-1", "abc", "1.5", ""])("rejects the limit %j", (limit) => {
    expect(listQuerySchema.safeParse({ limit }).success).toBe(false);
  });
});

describe("list cursors", () => {
  const cursor = {
    createdAt: "2026-10-12 14:58:15.473123+00",
    id: "00000000-0000-4000-8000-000000000001",
  };

  it("survives a round trip without losing microseconds", () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("accepts the other timestamp shapes Postgres prints", () => {
    for (const createdAt of [
      "2026-10-12 14:58:15+00",
      "2026-10-12 14:58:15.5+02",
      "2026-10-12 14:58:15.123456-05:30",
    ]) {
      expect(decodeCursor(encodeCursor({ ...cursor, createdAt })).createdAt).toBe(
        createdAt,
      );
    }
  });

  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  it.each([
    ["not base64 json", "%%%garbage"],
    ["json that is not an object", encode([1, 2])],
    ["a missing id", encode({ c: cursor.createdAt })],
    ["an id that is not a uuid", encode({ c: cursor.createdAt, i: "1" })],
    ["a timestamp that is not Postgres output", encode({ c: "yesterday", i: cursor.id })],
    [
      "an SQL fragment as the timestamp",
      encode({ c: "2026-10-12 14:58:15+00'; DROP TABLE events;--", i: cursor.id }),
    ],
    ["an extra field", encode({ c: cursor.createdAt, i: cursor.id, x: 1 })],
  ])("rejects %s with a 400", (_label, raw) => {
    expect(() => decodeCursor(raw)).toThrowError(
      expect.objectContaining({ status: 400, code: "VALIDATION_ERROR" }),
    );
  });
});

describe("nearbyQuerySchema", () => {
  it("turns the query strings into numbers", () => {
    expect(nearbyQuerySchema.parse({ latitude: "48.8566", longitude: "-2.35" })).toEqual({
      latitude: 48.8566,
      longitude: -2.35,
    });
  });

  it("accepts the edges of the map and zero", () => {
    expect(nearbyQuerySchema.parse({ latitude: "-90", longitude: "180" })).toEqual({
      latitude: -90,
      longitude: 180,
    });
    expect(nearbyQuerySchema.parse({ latitude: "0", longitude: "0" })).toEqual({
      latitude: 0,
      longitude: 0,
    });
  });

  it.each([
    ["missing latitude", { longitude: "2" }],
    ["missing longitude", { latitude: "48" }],
    // An empty value must not become 0, which is a real place.
    ["empty latitude", { latitude: "", longitude: "2" }],
    ["blank longitude", { latitude: "48", longitude: "  " }],
    ["not a number", { latitude: "north", longitude: "2" }],
    ["latitude past the pole", { latitude: "90.1", longitude: "2" }],
    ["longitude past the date line", { latitude: "48", longitude: "-180.5" }],
    ["infinity", { latitude: "Infinity", longitude: "2" }],
    // ?latitude=1&latitude=2 arrives as an array.
    ["a repeated parameter", { latitude: ["1", "2"], longitude: "2" }],
  ])("refuses %s", (_label, query) => {
    expect(nearbyQuerySchema.safeParse(query).success).toBe(false);
  });
});
