import type { MusicEvent } from "@music-room/shared";
import { describe, expect, it } from "vitest";
import { RequestError } from "@/api/api-error";
import { MESSAGES } from "@/auth/forms/error-messages";
import { voteLook } from "@/components/track-row-styles";
import { eventTags, voteLicenseLabel } from "@/features/track-vote/event-labels";
import {
  currentQueueFrom,
  TRACK_VOTE_MESSAGES,
  trackVoteErrorMessage,
} from "@/features/track-vote/messages";

const failure = (status: number, code: string, details: unknown = null) =>
  new RequestError(status, code as never, "server text, never shown", details);

describe("Track Vote error messages (from the stable code, never the server's text)", () => {
  it.each([
    [404, "EVENT_NOT_FOUND", TRACK_VOTE_MESSAGES.notFound],
    [404, "NOT_FOUND", TRACK_VOTE_MESSAGES.notFound],
    [403, "NOT_INVITED", TRACK_VOTE_MESSAGES.notInvited],
    [400, "LOCATION_REQUIRED", TRACK_VOTE_MESSAGES.imprecisePosition],
    [403, "OUTSIDE_VOTING_AREA", TRACK_VOTE_MESSAGES.outsideArea],
    [403, "OUTSIDE_VOTING_TIME", TRACK_VOTE_MESSAGES.outsideTime],
    [409, "TRACK_NOT_VOTABLE", TRACK_VOTE_MESSAGES.notVotable],
    [409, "QUEUE_CHANGED", TRACK_VOTE_MESSAGES.queueChanged],
    [403, "FORBIDDEN", TRACK_VOTE_MESSAGES.ownerOnly],
    [0, "NETWORK_ERROR", MESSAGES.network],
    [429, "RATE_LIMITED", MESSAGES.rateLimited],
    [500, "INTERNAL_ERROR", MESSAGES.server],
    [400, "VALIDATION_ERROR", TRACK_VOTE_MESSAGES.unknown],
  ])("%i %s", (status, code, message) => {
    expect(trackVoteErrorMessage(failure(status, code))).toBe(message);
  });

  it("something that is not a request error (a bug): the generic message", () => {
    expect(trackVoteErrorMessage(new TypeError("x"))).toBe(TRACK_VOTE_MESSAGES.unknown);
  });
});

describe("a 409 QUEUE_CHANGED carries the real queue", () => {
  const current = { eventId: "e1", version: 7, tracks: [] };

  it("is read from the error's details", () => {
    expect(currentQueueFrom(failure(409, "QUEUE_CHANGED", current))).toEqual(current);
  });

  it("is ignored when the details are missing or not a queue", () => {
    expect(currentQueueFrom(failure(409, "QUEUE_CHANGED", null))).toBeNull();
    expect(currentQueueFrom(failure(409, "QUEUE_CHANGED", { version: "7" }))).toBeNull();
    expect(currentQueueFrom(failure(409, "TRACK_NOT_VOTABLE", current))).toBeNull();
  });
});

describe("how an event's modes read", () => {
  it.each([
    [{ type: "everyone" } as const, "Everyone can vote"],
    [{ type: "invited_only" } as const, "Invited people vote"],
    [
      {
        type: "location_time",
        latitude: 0,
        longitude: 0,
        radiusMeters: 100,
        startsAt: "2026-10-20T10:00:00Z",
        endsAt: "2026-10-20T12:00:00Z",
      } as const,
      "Votes at the venue, during the event",
    ],
  ])("%o", (license, label) => {
    expect(voteLicenseLabel(license)).toBe(label);
  });

  const event = (overrides: Partial<MusicEvent>): MusicEvent => ({
    id: "e1",
    name: "Party",
    ownerId: "u1",
    visibility: "public",
    voteLicense: { type: "everyone" },
    createdAt: "2026-10-20T10:00:00Z",
    myPermissions: { canView: true, canAct: true, canManage: false },
    ...overrides,
  });

  it("tags my own events and private ones", () => {
    expect(eventTags(event({}))).toEqual([]);
    expect(
      eventTags(
        event({
          visibility: "private",
          myPermissions: { canView: true, canAct: true, canManage: true },
        }),
      ),
    ).toEqual(["Yours", "Private"]);
  });
});

describe("the vote control (DESIGN.md: Ember is the active voting state)", () => {
  it("is Ember with inverse text once I voted", () => {
    expect(voteLook(true, false)).toEqual({
      container: expect.stringContaining("bg-ember"),
      labelTone: "inverse",
    });
  });

  it("is outlined with primary text before I vote", () => {
    const look = voteLook(false, false);

    expect(look.container).toContain("border-line-subtle");
    expect(look.container).not.toContain("bg-ember");
    expect(look.labelTone).toBe("primary");
  });

  it("reads as inactive when I may not vote, even if I voted before", () => {
    expect(voteLook(true, true).labelTone).toBe("tertiary");
    expect(voteLook(true, true).container).not.toContain("bg-ember");
  });

  it("keeps the 48 px touch target in every state", () => {
    for (const [voted, disabled] of [
      [false, false],
      [true, false],
      [false, true],
    ] as const) {
      expect(voteLook(voted, disabled).container).toContain("min-h-12");
    }
  });
});
