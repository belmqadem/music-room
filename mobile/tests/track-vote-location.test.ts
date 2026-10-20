import type { EventTrack, GeoPoint } from "@music-room/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestError } from "@/api/api-error";
import { locationRuleText } from "@/features/track-vote/event-labels";
import { sendWithLocationIfRequired } from "@/features/track-vote/location-required";
import { POSITION_MESSAGES, trackVoteErrorMessage } from "@/features/track-vote/messages";
import { suggestOrVote } from "@/features/track-vote/suggest-track";
import { PositionUnavailableError, withTimeout } from "@/location/position-error";

const HERE: GeoPoint = { latitude: 48.8966, longitude: 2.3185, accuracyMeters: 12 };
const locationRequired = () => new RequestError(400, "LOCATION_REQUIRED", "x");

describe("asking for the position only when the server needs it", () => {
  it("votes without a position first; no position is asked when the server accepts", async () => {
    const send = vi.fn(async (location?: GeoPoint) => (location ? "with" : "without"));
    const getPosition = vi.fn(async () => HERE);

    const sent = await sendWithLocationIfRequired(send, getPosition, false);

    expect(sent).toEqual({ result: "without", locationRequired: false });
    expect(getPosition).not.toHaveBeenCalled();
  });

  it("on LOCATION_REQUIRED: gets the position and sends again, once, with it", async () => {
    const send = vi.fn(async (location?: GeoPoint) => {
      if (!location) throw locationRequired();
      return "accepted";
    });

    const sent = await sendWithLocationIfRequired(send, async () => HERE, false);

    expect(sent).toEqual({ result: "accepted", locationRequired: true });
    expect(send.mock.calls).toEqual([[], [HERE]]);
  });

  it("once the event is known to need it, sends the position straight away", async () => {
    const send = vi.fn(async (location?: GeoPoint) => location);

    const sent = await sendWithLocationIfRequired(send, async () => HERE, true);

    expect(send).toHaveBeenCalledTimes(1);
    expect(sent.result).toEqual(HERE);
  });

  it("outside the event's hours the server says so first: nobody is asked for a position", async () => {
    const closed = new RequestError(403, "OUTSIDE_VOTING_TIME", "x");
    const getPosition = vi.fn(async () => HERE);

    await expect(
      sendWithLocationIfRequired(
        async () => {
          throw closed;
        },
        getPosition,
        false,
      ),
    ).rejects.toBe(closed);
    expect(getPosition).not.toHaveBeenCalled();
  });

  it("no position available (permission refused): that error is raised, nothing is sent again", async () => {
    const send = vi.fn(async () => {
      throw locationRequired();
    });
    const refused = new PositionUnavailableError("denied");

    await expect(
      sendWithLocationIfRequired(
        send,
        async () => {
          throw refused;
        },
        false,
      ),
    ).rejects.toBe(refused);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a position the server still refuses (not precise enough) is raised, not retried in a loop", async () => {
    const send = vi.fn(async () => {
      throw locationRequired();
    });

    await expect(
      sendWithLocationIfRequired(send, async () => HERE, false),
    ).rejects.toMatchObject({
      code: "LOCATION_REQUIRED",
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("the outside-area answer after sending the position is raised as it is", async () => {
    const far = new RequestError(403, "OUTSIDE_VOTING_AREA", "x");
    const send = vi.fn(async (location?: GeoPoint) => {
      throw location ? far : locationRequired();
    });

    await expect(sendWithLocationIfRequired(send, async () => HERE, false)).rejects.toBe(
      far,
    );
  });
});

describe("a suggestion in a place-and-time event", () => {
  const entry = { id: "q1", eventId: "e1", votedByMe: true } as EventTrack;

  it("sends the position with the suggestion", async () => {
    const calls = { suggest: vi.fn(async () => entry), vote: vi.fn() };

    await suggestOrVote(calls, "e1", "p1", HERE);

    expect(calls.suggest).toHaveBeenCalledWith("e1", "p1", HERE);
  });

  it("and with the vote that replaces it when the track is already queued", async () => {
    const calls = {
      suggest: vi.fn(async () => {
        throw new RequestError(409, "TRACK_ALREADY_QUEUED", "x", entry);
      }),
      vote: vi.fn(async () => entry),
    };

    await suggestOrVote(calls, "e1", "p1", HERE);

    expect(calls.vote).toHaveBeenCalledWith("e1", "q1", HERE);
  });
});

describe("no position", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gives up after the time limit instead of spinning forever", async () => {
    const never = new Promise<GeoPoint>(() => undefined);
    const result = withTimeout(never, 15_000).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(await result).toMatchObject({ problem: "timeout" });
  });

  it("returns the position when it comes in time", async () => {
    const result = withTimeout(Promise.resolve(HERE), 15_000);

    await expect(result).resolves.toEqual(HERE);
  });

  it.each(["services_off", "denied", "blocked", "timeout"] as const)(
    "%s has its own message",
    (problem) => {
      expect(trackVoteErrorMessage(new PositionUnavailableError(problem))).toBe(
        POSITION_MESSAGES[problem],
      );
    },
  );
});

describe("the rule as the user reads it", () => {
  it("gives the radius and the window, in the formatter's words", () => {
    const text = locationRuleText(
      {
        latitude: 48.9,
        longitude: 2.3,
        radiusMeters: 150,
        startsAt: "2026-10-20T19:00:00.000Z",
        endsAt: "2026-10-20T23:00:00.000Z",
      },
      (iso) => iso.slice(11, 16),
    );

    expect(text).toBe("Within 150 m of the venue, from 19:00 to 23:00.");
  });
});
