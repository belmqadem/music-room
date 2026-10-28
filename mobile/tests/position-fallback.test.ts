import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PositionUnavailableError } from "@/location/position-error";
import {
  LAST_KNOWN_MAX_AGE_MS,
  MAX_ACCURACY_METERS,
  positionWithFallback,
  usableLastKnown,
  type PositionReading,
} from "@/location/position-fallback";

// No fresh fix in time: a recent, precise last known position is used instead.

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const NOW = 1_800_000_000_000;
const reading = (over: Partial<PositionReading> = {}): PositionReading => ({
  latitude: 48.8966,
  longitude: 2.3185,
  accuracy: 10,
  timestamp: NOW - 30_000,
  ...over,
});
const timedOut = () => Promise.reject(new PositionUnavailableError("timeout"));

describe("which last known position may be sent", () => {
  it("a recent and precise one", () => {
    const known = reading();
    expect(usableLastKnown(known, NOW)).toBe(known);
  });

  it("exactly at the age and accuracy limits: still used", () => {
    const known = reading({
      timestamp: NOW - LAST_KNOWN_MAX_AGE_MS,
      accuracy: MAX_ACCURACY_METERS,
    });
    expect(usableLastKnown(known, NOW)).toBe(known);
  });

  it.each([
    ["none at all", null],
    ["older than the limit", reading({ timestamp: NOW - LAST_KNOWN_MAX_AGE_MS - 1 })],
    [
      "less precise than the server accepts",
      reading({ accuracy: MAX_ACCURACY_METERS + 1 }),
    ],
    ["with no accuracy (the server could not judge it)", reading({ accuracy: null })],
  ])("not %s", (_label, known) => {
    expect(usableLastKnown(known, NOW)).toBeNull();
  });
});

describe("a fresh position, or the last known one", () => {
  it("a fresh fix is used, and the last known position is not even read", async () => {
    const fresh = reading({ timestamp: NOW, accuracy: 5 });
    const lastKnown = vi.fn(async () => reading());

    await expect(
      positionWithFallback(
        async () => fresh,
        lastKnown,
        () => NOW,
      ),
    ).resolves.toBe(fresh);
    expect(lastKnown).not.toHaveBeenCalled();
  });

  it("no fresh fix in time: a usable last known position is used", async () => {
    const known = reading();

    await expect(
      positionWithFallback(
        timedOut,
        async () => known,
        () => NOW,
      ),
    ).resolves.toBe(known);
  });

  it("no fresh fix and a last known position too old: the time-out is raised", async () => {
    const stale = reading({ timestamp: NOW - LAST_KNOWN_MAX_AGE_MS - 1 });

    await expect(
      positionWithFallback(
        timedOut,
        async () => stale,
        () => NOW,
      ),
    ).rejects.toMatchObject({ problem: "timeout" });
  });

  it("a time-out with nothing usable: that same error is raised, not logged as a phone failure", async () => {
    const timeout = new PositionUnavailableError("timeout");

    await expect(
      positionWithFallback(
        () => Promise.reject(timeout),
        async () => null,
        () => NOW,
      ),
    ).rejects.toBe(timeout);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("the phone fails (not a time-out) with nothing known: reported as no position, and logged", async () => {
    const failure = new Error("Location provider is unavailable");

    await expect(
      positionWithFallback(
        () => Promise.reject(failure),
        async () => null,
        () => NOW,
      ),
    ).rejects.toMatchObject({ problem: "timeout" });
    expect(console.warn).toHaveBeenCalledWith(
      "The phone could not give a position:",
      failure,
    );
  });

  it("the phone fails but knows a recent position: that one is used", async () => {
    const known = reading();

    await expect(
      positionWithFallback(
        () => Promise.reject(new Error("unavailable")),
        async () => known,
        () => NOW,
      ),
    ).resolves.toBe(known);
  });

  it("reading the last known position fails too: the first reason is raised, the second logged", async () => {
    const readFailure = new Error("last known failed");

    await expect(
      positionWithFallback(
        timedOut,
        () => Promise.reject(readFailure),
        () => NOW,
      ),
    ).rejects.toMatchObject({ problem: "timeout" });
    expect(console.warn).toHaveBeenCalledWith(
      "Could not read the last known position:",
      readFailure,
    );
  });
});
