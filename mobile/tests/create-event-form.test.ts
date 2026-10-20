import { describe, expect, it } from "vitest";
import {
  coordinateFrom,
  createEventRequestFrom,
  DRAFT_MESSAGES,
  EMPTY_DRAFT,
  type CreateEventDraft,
} from "@/features/track-vote/create-event-form";
// The backend's own schema, to prove the app builds what it accepts (tests only; never shipped).
import { createEventSchema } from "../../backend/src/modules/track-vote/schema";

const NOW = new Date("2026-10-20T20:00:00.000Z");
const draft = (overrides: Partial<CreateEventDraft>): CreateEventDraft => ({
  ...EMPTY_DRAFT,
  name: "Friday night",
  ...overrides,
});
const venue = {
  mode: "location_time" as const,
  latitude: "48.8966",
  longitude: "2.3185",
};

describe("the request the form becomes", () => {
  it("a public event everyone can vote in (the defaults)", () => {
    expect(createEventRequestFrom(draft({}), NOW)).toEqual({
      ok: true,
      request: {
        name: "Friday night",
        visibility: "public",
        voteLicense: { type: "everyone" },
      },
    });
  });

  it("a private event where only invited people vote", () => {
    const result = createEventRequestFrom(
      draft({ visibility: "private", mode: "invited_only" }),
      NOW,
    );

    expect(result).toMatchObject({
      ok: true,
      request: { visibility: "private", voteLicense: { type: "invited_only" } },
    });
  });

  it("a place-and-time event: venue, radius, and a window from the chosen start and length", () => {
    const result = createEventRequestFrom(
      draft({ ...venue, radiusMeters: 500, startsInMinutes: 60, durationHours: 2 }),
      NOW,
    );

    expect(result).toEqual({
      ok: true,
      request: {
        name: "Friday night",
        visibility: "public",
        voteLicense: {
          type: "location_time",
          latitude: 48.8966,
          longitude: 2.3185,
          radiusMeters: 500,
          startsAt: "2026-10-20T21:00:00.000Z",
          endsAt: "2026-10-20T23:00:00.000Z",
        },
      },
    });
  });

  it("trims the name, and sends no venue fields for the other two modes", () => {
    const result = createEventRequestFrom(
      draft({ name: "  Party  ", latitude: "junk", mode: "everyone" }),
      NOW,
    );

    expect(result).toEqual({
      ok: true,
      request: { name: "Party", visibility: "public", voteLicense: { type: "everyone" } },
    });
  });
});

describe("what the form refuses", () => {
  it.each([
    ["", DRAFT_MESSAGES.nameMissing],
    ["   ", DRAFT_MESSAGES.nameMissing],
    ["x".repeat(101), DRAFT_MESSAGES.nameTooLong],
  ])("the name %j", (name, message) => {
    expect(createEventRequestFrom(draft({ name }), NOW)).toEqual({
      ok: false,
      errors: { name: message },
    });
  });

  it("accepts a name of exactly 100 characters", () => {
    expect(createEventRequestFrom(draft({ name: "x".repeat(100) }), NOW).ok).toBe(true);
  });

  it("a venue without valid coordinates, field by field", () => {
    expect(
      createEventRequestFrom(draft({ ...venue, latitude: "91", longitude: "" }), NOW),
    ).toEqual({
      ok: false,
      errors: { latitude: DRAFT_MESSAGES.latitude, longitude: DRAFT_MESSAGES.longitude },
    });
  });

  it("reports the name and the venue together, so the user fixes everything at once", () => {
    const result = createEventRequestFrom(
      draft({ ...venue, name: "", latitude: "x" }),
      NOW,
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(["latitude", "name"]);
  });
});

describe("reading a typed coordinate", () => {
  it.each([
    ["48.8966", 48.8966],
    ["-33.5", -33.5],
    ["48,8966", 48.8966],
    [" 2 ", 2],
    ["90", 90],
  ])("%j is %d", (text, value) => {
    expect(coordinateFrom(text, 90)).toBe(value);
  });

  it.each(["", "abc", "1e3", "90.0001", "--1", "4 8"])("%j is refused", (text) => {
    expect(coordinateFrom(text, 90)).toBeNull();
  });
});

describe("the backend accepts what the app builds (parity with track-vote/schema.ts)", () => {
  it.each([
    ["defaults", draft({})],
    ["private, invited only", draft({ visibility: "private", mode: "invited_only" })],
    ["place and time, starting now", draft({ ...venue })],
    [
      "place and time, edge values",
      draft({
        ...venue,
        latitude: "-90",
        longitude: "180",
        radiusMeters: 1000,
        durationHours: 8,
      }),
    ],
    ["a 100-character name", draft({ name: "x".repeat(100) })],
  ])("%s", (_label, input) => {
    const result = createEventRequestFrom(input, NOW);

    expect(result.ok).toBe(true);
    expect(result.ok && createEventSchema.safeParse(result.request).success).toBe(true);
  });

  it("and the backend refuses the names the app refuses", () => {
    for (const name of ["", "   ", "x".repeat(101)]) {
      expect(
        createEventSchema.safeParse({ name, voteLicense: { type: "everyone" } }).success,
      ).toBe(false);
    }
  });
});
