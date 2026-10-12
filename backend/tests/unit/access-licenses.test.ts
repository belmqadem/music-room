import { describe, expect, it } from "vitest";
import {
  eventLicenseFromColumns,
  playlistLicenseFromColumn,
} from "../../src/modules/access/repository.js";

const noLocation = {
  latitude: null,
  longitude: null,
  radius_meters: null,
  starts_at: null,
  ends_at: null,
};

describe("eventLicenseFromColumns", () => {
  it.each(["everyone", "invited_only"] as const)("reads the %s license", (type) => {
    expect(eventLicenseFromColumns({ vote_license: type, ...noLocation })).toEqual({
      type,
    });
  });

  it("reads a location_time license with its dates", () => {
    const startsAt = new Date("2026-10-12T18:00:00Z");
    const endsAt = new Date("2026-10-12T22:00:00Z");

    expect(
      eventLicenseFromColumns({
        vote_license: "location_time",
        latitude: 48.8,
        longitude: 2.3,
        radius_meters: 500,
        starts_at: startsAt,
        ends_at: endsAt,
      }),
    ).toEqual({
      type: "location_time",
      latitude: 48.8,
      longitude: 2.3,
      radiusMeters: 500,
      startsAt,
      endsAt,
    });
  });

  it.each(["latitude", "longitude", "radius_meters", "starts_at", "ends_at"] as const)(
    "throws instead of guessing when location_time has no %s",
    (missing) => {
      const full = {
        vote_license: "location_time",
        latitude: 1,
        longitude: 2,
        radius_meters: 3,
        starts_at: new Date(0),
        ends_at: new Date(1),
      };

      expect(() => eventLicenseFromColumns({ ...full, [missing]: null })).toThrowError(
        /missing location fields/,
      );
    },
  );

  it("throws on an unknown license", () => {
    expect(() =>
      eventLicenseFromColumns({ vote_license: "friends", ...noLocation }),
    ).toThrowError(/Unknown vote license/);
  });
});

describe("playlistLicenseFromColumn", () => {
  it("reads the two playlist licenses and rejects anything else", () => {
    expect(playlistLicenseFromColumn("everyone")).toEqual({ type: "everyone" });
    expect(playlistLicenseFromColumn("invited_only")).toEqual({ type: "invited_only" });
    expect(() => playlistLicenseFromColumn("location_time")).toThrowError(
      /Unknown edit license/,
    );
  });
});
