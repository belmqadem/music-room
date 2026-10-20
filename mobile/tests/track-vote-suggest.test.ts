import type { EventTrack } from "@music-room/shared";
import { describe, expect, it, vi } from "vitest";
import { RequestError } from "@/api/api-error";
import {
  TRACK_VOTE_MESSAGES,
  queuedTrackFrom,
  trackVoteErrorMessage,
} from "@/features/track-vote/messages";
import { suggestOrVote } from "@/features/track-vote/suggest-track";

const entry = (id: string, votedByMe: boolean): EventTrack => ({
  id,
  eventId: "e1",
  track: {
    providerTrackId: "p1",
    title: "T",
    artist: "A",
    durationSeconds: 100,
    coverUrl: null,
  },
  suggestedBy: "u1",
  voteCount: 1,
  votedByMe,
  status: "queued",
  suggestedAt: "2026-10-20T10:00:00Z",
});
const alreadyQueued = (existing: unknown) =>
  new RequestError(409, "TRACK_ALREADY_QUEUED", "x", existing);

describe("suggesting a track", () => {
  it("adds it; the answer says I vote for it (a suggestion counts as my vote)", async () => {
    const calls = { suggest: vi.fn(async () => entry("new", true)), vote: vi.fn() };

    const result = await suggestOrVote(calls, "e1", "p1");

    expect(result).toEqual({ track: entry("new", true), alreadyQueued: false });
    expect(calls.suggest).toHaveBeenCalledWith("e1", "p1");
    expect(calls.vote).not.toHaveBeenCalled();
  });

  it("already queued (409, with the track): votes for that track instead", async () => {
    const calls = {
      suggest: vi.fn(async () => {
        throw alreadyQueued(entry("queued-1", false));
      }),
      vote: vi.fn(async () => entry("queued-1", true)),
    };

    const result = await suggestOrVote(calls, "e1", "p1");

    expect(calls.vote).toHaveBeenCalledWith("e1", "queued-1");
    expect(result).toEqual({ track: entry("queued-1", true), alreadyQueued: true });
  });

  it("already queued but the vote fails (the track started playing meanwhile): the vote's error is raised", async () => {
    const notVotable = new RequestError(409, "TRACK_NOT_VOTABLE", "x");
    const calls = {
      suggest: vi.fn(async () => {
        throw alreadyQueued(entry("queued-1", false));
      }),
      vote: vi.fn(async () => {
        throw notVotable;
      }),
    };

    await expect(suggestOrVote(calls, "e1", "p1")).rejects.toBe(notVotable);
  });

  it.each([
    ["not allowed", new RequestError(403, "NOT_INVITED", "x")],
    ["unknown to the catalog", new RequestError(404, "TRACK_NOT_FOUND", "x")],
    ["catalog down", new RequestError(502, "PROVIDER_UNAVAILABLE", "x")],
    ["a 409 without the track in its details", alreadyQueued(null)],
  ])("any other failure (%s) is raised, without voting", async (_label, failure) => {
    const calls = {
      suggest: vi.fn(async () => {
        throw failure;
      }),
      vote: vi.fn(),
    };

    await expect(suggestOrVote(calls, "e1", "p1")).rejects.toBe(failure);
    expect(calls.vote).not.toHaveBeenCalled();
  });
});

describe("catalog messages and the queued track in a 409", () => {
  it.each([
    [404, "TRACK_NOT_FOUND", TRACK_VOTE_MESSAGES.catalogMissing],
    [502, "PROVIDER_UNAVAILABLE", TRACK_VOTE_MESSAGES.catalogDown],
  ])("%i %s", (status, code, message) => {
    expect(trackVoteErrorMessage(new RequestError(status, code as never, "x"))).toBe(
      message,
    );
  });

  it("reads the queued track only from a TRACK_ALREADY_QUEUED with a real track", () => {
    expect(queuedTrackFrom(alreadyQueued(entry("q", false)))?.id).toBe("q");
    expect(queuedTrackFrom(alreadyQueued({ id: 5 }))).toBeNull();
    expect(
      queuedTrackFrom(new RequestError(409, "QUEUE_CHANGED", "x", entry("q", false))),
    ).toBeNull();
  });
});
