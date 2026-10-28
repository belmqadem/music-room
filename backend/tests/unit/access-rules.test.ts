import { describe, expect, it } from "vitest";
import {
  canView,
  decideAct,
  decideManage,
  distanceMeters,
  MAX_ACCURACY_METERS,
  permissionsOf,
  type AccessLicense,
  type AccessResource,
  type AccessSubject,
  type ActContext,
} from "../../src/modules/access/rules.js";

const OWNER = "owner-id";
const OTHER = "someone-else";

const resourceWith = (
  license: AccessLicense,
  visibility: "public" | "private" = "public",
): AccessResource => ({ ownerId: OWNER, visibility, license });

const owner: AccessSubject = { userId: OWNER, isInvited: false };
const invited: AccessSubject = { userId: OTHER, isInvited: true };
const stranger: AccessSubject = { userId: OTHER, isInvited: false };

const NOW = new Date("2026-10-12T20:00:00Z");
const context: ActContext = { now: NOW };

describe("canView", () => {
  it.each([
    ["public", "the owner", owner, true],
    ["public", "an invited user", invited, true],
    ["public", "a stranger", stranger, true],
    ["private", "the owner", owner, true],
    ["private", "an invited user", invited, true],
    ["private", "a stranger", stranger, false],
  ] as const)("%s resource, %s -> %s", (visibility, _who, subject, expected) => {
    expect(canView(resourceWith({ type: "everyone" }, visibility), subject)).toBe(
      expected,
    );
  });

  it("does not let an invitation flag of the owner matter", () => {
    expect(
      canView(resourceWith({ type: "everyone" }, "private"), {
        userId: OWNER,
        isInvited: false,
      }),
    ).toBe(true);
  });
});

describe("decideAct with the everyone and invited_only licenses", () => {
  // visibility x license x who -> expected refusal (null = allowed)
  it.each([
    // everyone
    ["public", "everyone", owner, null],
    ["public", "everyone", invited, null],
    ["public", "everyone", stranger, null],
    ["private", "everyone", owner, null],
    ["private", "everyone", invited, null],
    ["private", "everyone", stranger, "NOT_FOUND"],
    // invited_only
    ["public", "invited_only", owner, null],
    ["public", "invited_only", invited, null],
    ["public", "invited_only", stranger, "NOT_INVITED"], // can view, cannot act
    ["private", "invited_only", owner, null],
    ["private", "invited_only", invited, null],
    ["private", "invited_only", stranger, "NOT_FOUND"], // cannot even see it
  ] as const)("%s + %s license, %#", (visibility, license, subject, refusal) => {
    const decision = decideAct(
      resourceWith({ type: license }, visibility),
      subject,
      context,
    );

    expect(decision).toEqual(
      refusal === null ? { allowed: true } : { allowed: false, refusal },
    );
  });
});

describe("decideAct with the location_time license", () => {
  const PARIS = { latitude: 48.8566, longitude: 2.3522 };
  const startsAt = new Date("2026-10-12T18:00:00Z");
  const endsAt = new Date("2026-10-12T22:00:00Z");
  const rule: AccessLicense = {
    type: "location_time",
    ...PARIS,
    radiusMeters: 500,
    startsAt,
    endsAt,
  };
  const resource = resourceWith(rule);
  // About 0.001 degree of latitude is 111 m.
  const at = (northMetres: number, accuracyMeters: number | null = 10) => ({
    latitude: PARIS.latitude + northMetres / 111_195,
    longitude: PARIS.longitude,
    // null means "the phone reported no accuracy at all".
    ...(accuracyMeters !== null && { accuracyMeters }),
  });
  const decide = (subject: AccessSubject, now: Date, position?: ActContext["position"]) =>
    decideAct(resource, subject, { now, position });

  it("allows someone inside the area during the window", () => {
    expect(decide(stranger, NOW, at(100))).toEqual({ allowed: true });
    expect(decide(stranger, NOW, at(0))).toEqual({ allowed: true });
  });

  it("refuses someone outside the area", () => {
    expect(decide(stranger, NOW, at(600))).toEqual({
      allowed: false,
      refusal: "OUTSIDE_VOTING_AREA",
    });
  });

  it("counts a position exactly on the radius as inside", () => {
    const exact = {
      ...resource,
      license: { ...rule, radiusMeters: distanceMeters(PARIS, at(300)) },
    };
    const decision = decideAct(exact, stranger, { now: NOW, position: at(300) });

    expect(decision).toEqual({ allowed: true });
  });

  it("opens at the start instant and closes at the end instant", () => {
    expect(decide(stranger, new Date(startsAt.getTime() - 1), at(0)).allowed).toBe(false);
    expect(decide(stranger, startsAt, at(0)).allowed).toBe(true);
    expect(decide(stranger, new Date(endsAt.getTime() - 1), at(0)).allowed).toBe(true);
    expect(decide(stranger, endsAt, at(0))).toEqual({
      allowed: false,
      refusal: "OUTSIDE_VOTING_TIME",
    });
  });

  it("judges the time first: outside the window it does not even ask for a position", () => {
    const early = new Date("2026-10-12T10:00:00Z");

    expect(decide(stranger, early)).toEqual({
      allowed: false,
      refusal: "OUTSIDE_VOTING_TIME",
    });
  });

  it("asks for a location when there is none", () => {
    expect(decide(stranger, NOW)).toEqual({
      allowed: false,
      refusal: "LOCATION_REQUIRED",
    });
  });

  it("accepts an accuracy of exactly the maximum and refuses anything worse or unknown", () => {
    expect(decide(stranger, NOW, at(0, MAX_ACCURACY_METERS)).allowed).toBe(true);
    for (const accuracy of [MAX_ACCURACY_METERS + 0.1, 5000, -1, Number.NaN, null]) {
      expect(decide(stranger, NOW, at(0, accuracy))).toEqual({
        allowed: false,
        refusal: "LOCATION_REQUIRED",
      });
    }
  });

  it.each([
    ["a latitude above 90", { latitude: 91, longitude: 2, accuracyMeters: 10 }],
    ["a longitude below -180", { latitude: 48, longitude: -181, accuracyMeters: 10 }],
    ["a NaN latitude", { latitude: Number.NaN, longitude: 2, accuracyMeters: 10 }],
    ["an infinite longitude", { latitude: 48, longitude: Infinity, accuracyMeters: 10 }],
  ])("treats %s as no usable location", (_label, position) => {
    expect(decide(stranger, NOW, position)).toEqual({
      allowed: false,
      refusal: "LOCATION_REQUIRED",
    });
  });

  it("does not let an invitation skip the place and time rule", () => {
    expect(decide(invited, NOW, at(600)).allowed).toBe(false);
    expect(decide(invited, new Date("2026-10-12T10:00:00Z"), at(0)).allowed).toBe(false);
  });

  it("lets the owner act anywhere, any time", () => {
    expect(decide(owner, new Date("2030-01-01T00:00:00Z"), at(50_000)).allowed).toBe(
      true,
    );
    expect(decide(owner, NOW).allowed).toBe(true);
  });

  it("hides a private event from a stranger even with a perfect location", () => {
    const privateEvent = resourceWith(rule, "private");

    expect(decideAct(privateEvent, stranger, { now: NOW, position: at(0) })).toEqual({
      allowed: false,
      refusal: "NOT_FOUND",
    });
  });

  it("lets an invited user of a private event be judged by place and time", () => {
    const privateEvent = resourceWith(rule, "private");

    expect(decideAct(privateEvent, invited, { now: NOW, position: at(0) }).allowed).toBe(
      true,
    );
    expect(
      decideAct(privateEvent, invited, { now: NOW, position: at(900) }).allowed,
    ).toBe(false);
  });

  it("uses the clock it is given, not the real one", () => {
    const longAgo = {
      ...resource,
      license: { ...rule, startsAt: new Date(0), endsAt: new Date(1000) },
    };

    expect(
      decideAct(longAgo, stranger, { now: new Date(500), position: at(0) }).allowed,
    ).toBe(true);
    expect(
      decideAct(longAgo, stranger, { now: new Date(), position: at(0) }).allowed,
    ).toBe(false);
  });
});

describe("decideAct failing closed", () => {
  it("throws on a license it does not know instead of allowing", () => {
    const broken = resourceWith({ type: "friends_only" } as unknown as AccessLicense);

    expect(() => decideAct(broken, stranger, context)).toThrowError(/Unknown license/);
  });

  it("still refuses an unseen private resource before looking at the license", () => {
    const broken = resourceWith(
      { type: "friends_only" } as unknown as AccessLicense,
      "private",
    );

    expect(decideAct(broken, stranger, context)).toEqual({
      allowed: false,
      refusal: "NOT_FOUND",
    });
  });
});

describe("decideManage", () => {
  it.each([
    ["public", owner, null],
    ["public", invited, "FORBIDDEN"],
    ["public", stranger, "FORBIDDEN"],
    ["private", owner, null],
    ["private", invited, "FORBIDDEN"],
    ["private", stranger, "NOT_FOUND"],
  ] as const)("%s resource, subject %#", (visibility, subject, refusal) => {
    const decision = decideManage(
      resourceWith({ type: "everyone" }, visibility),
      subject,
    );

    expect(decision).toEqual(
      refusal === null ? { allowed: true } : { allowed: false, refusal },
    );
  });
});

describe("permissionsOf (the UI hint)", () => {
  const locationTime: AccessLicense = {
    type: "location_time",
    latitude: 0,
    longitude: 0,
    radiusMeters: 10,
    startsAt: new Date(0),
    endsAt: new Date(1),
  };

  it.each([
    [
      "public everyone, stranger",
      resourceWith({ type: "everyone" }),
      stranger,
      [true, true, false],
    ],
    [
      "public invited_only, stranger",
      resourceWith({ type: "invited_only" }),
      stranger,
      [true, false, false],
    ],
    [
      "public invited_only, invited",
      resourceWith({ type: "invited_only" }),
      invited,
      [true, true, false],
    ],
    [
      "public location_time, stranger (eligible)",
      resourceWith(locationTime),
      stranger,
      [true, true, false],
    ],
    [
      "private everyone, stranger",
      resourceWith({ type: "everyone" }, "private"),
      stranger,
      [false, false, false],
    ],
    [
      "private location_time, stranger",
      resourceWith(locationTime, "private"),
      stranger,
      [false, false, false],
    ],
    [
      "private invited_only, invited",
      resourceWith({ type: "invited_only" }, "private"),
      invited,
      [true, true, false],
    ],
    [
      "any, owner",
      resourceWith({ type: "invited_only" }, "private"),
      owner,
      [true, true, true],
    ],
  ] as const)("%s", (_label, resource, subject, [view, act, manage]) => {
    expect(permissionsOf(resource, subject)).toEqual({
      canView: view,
      canAct: act,
      canManage: manage,
    });
  });
});

describe("distanceMeters", () => {
  it("is zero for the same point", () => {
    expect(
      distanceMeters({ latitude: 10, longitude: 20 }, { latitude: 10, longitude: 20 }),
    ).toBe(0);
  });

  it("measures one degree of longitude on the equator as about 111.2 km", () => {
    const metres = distanceMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
    );

    expect(metres).toBeGreaterThan(111_000);
    expect(metres).toBeLessThan(111_400);
  });

  it("measures Paris to London as about 344 km", () => {
    const metres = distanceMeters(
      { latitude: 48.8566, longitude: 2.3522 },
      { latitude: 51.5072, longitude: -0.1276 },
    );

    expect(metres / 1000).toBeGreaterThan(340);
    expect(metres / 1000).toBeLessThan(348);
  });

  it("is symmetric", () => {
    const a = { latitude: 12.3, longitude: 45.6 };
    const b = { latitude: -33.9, longitude: 151.2 };

    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6);
  });

  it("handles points across the antimeridian and the poles", () => {
    const across = distanceMeters(
      { latitude: 0, longitude: 179.9 },
      { latitude: 0, longitude: -179.9 },
    );

    expect(across).toBeLessThan(25_000);
    expect(
      distanceMeters({ latitude: 90, longitude: 0 }, { latitude: -90, longitude: 0 }) /
        1000,
    ).toBeCloseTo(20_015, -1);
  });
});
