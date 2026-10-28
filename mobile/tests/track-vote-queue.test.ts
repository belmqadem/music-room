import type { EventTrack, QueueSnapshot } from "@music-room/shared";
import { describe, expect, it } from "vitest";
import {
  applyMyQueue,
  applyMyVote,
  applySnapshot,
  EMPTY_QUEUE,
  playingTrack,
  visibleTracks,
  type QueueState,
} from "@/features/track-vote/queue-state";

const EVENT = "e1";

function track(id: string, overrides: Partial<EventTrack> = {}): EventTrack {
  return {
    id,
    eventId: EVENT,
    track: {
      providerTrackId: `p-${id}`,
      title: `Title ${id}`,
      artist: "Artist",
      durationSeconds: 200,
      coverUrl: null,
    },
    suggestedBy: "u1",
    voteCount: 1,
    votedByMe: false,
    status: "queued",
    suggestedAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

/** What the socket sends: the same entries, without votedByMe. */
function snapshot(version: number, tracks: EventTrack[]): QueueSnapshot {
  return {
    eventId: EVENT,
    version,
    tracks: tracks.map(({ votedByMe: _mine, ...entry }) => entry),
  };
}

const ids = (state: QueueState) => visibleTracks(state).map((t) => t.id);
const voted = (state: QueueState) =>
  visibleTracks(state)
    .filter((t) => t.votedByMe)
    .map((t) => t.id);

describe("the first queue", () => {
  it("is shown as the server ordered it, with my votes", () => {
    const state = applyMyQueue(EMPTY_QUEUE, {
      eventId: EVENT,
      version: 3,
      tracks: [
        track("a", { status: "playing" }),
        track("b", { voteCount: 5, votedByMe: true }),
        track("c", { voteCount: 2 }),
      ],
    });

    expect(state.version).toBe(3);
    expect(ids(state)).toEqual(["a", "b", "c"]);
    expect(voted(state)).toEqual(["b"]);
    expect(playingTrack(state)?.id).toBe("a");
  });

  it("can be empty, which is still a loaded queue (version 0)", () => {
    const state = applyMyQueue(EMPTY_QUEUE, { eventId: EVENT, version: 0, tracks: [] });

    expect(state.version).toBe(0);
    expect(visibleTracks(state)).toEqual([]);
    expect(playingTrack(state)).toBeNull();
  });

  it("is never re-sorted by the app, even if the counts look out of order", () => {
    const state = applyMyQueue(EMPTY_QUEUE, {
      eventId: EVENT,
      version: 1,
      tracks: [track("low", { voteCount: 1 }), track("high", { voteCount: 9 })],
    });

    expect(ids(state)).toEqual(["low", "high"]);
  });
});

describe("queues arriving late or out of order", () => {
  const v5 = applyMyQueue(EMPTY_QUEUE, {
    eventId: EVENT,
    version: 5,
    tracks: [track("a", { voteCount: 3, votedByMe: true }), track("b")],
  });

  it("ignores a socket snapshot older than the queue held", () => {
    expect(applySnapshot(v5, snapshot(4, [track("old")]))).toBe(v5);
  });

  it("ignores a snapshot with the same version (nothing changed)", () => {
    expect(applySnapshot(v5, snapshot(5, [track("same")]))).toBe(v5);
  });

  it("ignores an older REST queue too, so a slow request cannot undo newer changes", () => {
    const stale = applyMyQueue(v5, { eventId: EVENT, version: 2, tracks: [] });

    expect(stale).toBe(v5);
  });

  it("ignores a REST queue with the same version, so a slow read cannot undo my vote's answer", () => {
    const myVoteShown = applyMyVote(v5, track("b", { votedByMe: true }));
    const slowRead = applyMyQueue(myVoteShown, {
      eventId: EVENT,
      version: 5,
      tracks: [track("a", { votedByMe: true }), track("b", { votedByMe: false })],
    });

    expect(slowRead).toBe(myVoteShown);
    expect(voted(slowRead)).toEqual(["a", "b"]);
  });

  it("applies a newer snapshot: its order and counts replace the old ones", () => {
    const next = applySnapshot(
      v5,
      snapshot(7, [track("b", { voteCount: 4 }), track("a", { voteCount: 3 })]),
    );

    expect(next.version).toBe(7);
    expect(ids(next)).toEqual(["b", "a"]);
    expect(visibleTracks(next).map((t) => t.voteCount)).toEqual([4, 3]);
  });

  it("keeps my votes through socket snapshots, which never carry them", () => {
    const next = applySnapshot(v5, snapshot(6, [track("b"), track("a")]));

    expect(voted(next)).toEqual(["a"]);
  });

  it("takes my votes from a newer REST queue, which does carry them", () => {
    const next = applyMyQueue(v5, {
      eventId: EVENT,
      version: 8,
      tracks: [track("a", { votedByMe: false }), track("b", { votedByMe: true })],
    });

    expect(voted(next)).toEqual(["b"]);
  });

  it("forgets my vote for a track that left the queue (played), per the newer REST queue", () => {
    const next = applyMyQueue(v5, { eventId: EVENT, version: 9, tracks: [track("b")] });

    expect(next.myVotes.has("a")).toBe(false);
  });
});

describe("my own vote", () => {
  const base = applyMyQueue(EMPTY_QUEUE, {
    eventId: EVENT,
    version: 1,
    tracks: [track("a", { voteCount: 2 }), track("b")],
  });

  it("marks the track once the server answers, without touching counts or order", () => {
    const next = applyMyVote(base, track("b", { voteCount: 2, votedByMe: true }));

    expect(voted(next)).toEqual(["b"]);
    expect(ids(next)).toEqual(["a", "b"]);
    expect(visibleTracks(next).map((t) => t.voteCount)).toEqual([2, 1]);
    expect(next.version).toBe(1);
  });

  it("unmarks it on a withdrawal", () => {
    const votedB = applyMyVote(base, track("b", { votedByMe: true }));

    expect(voted(applyMyVote(votedB, track("b", { votedByMe: false })))).toEqual([]);
  });

  it("changes nothing when the answer matches what is shown (a repeated vote)", () => {
    const votedB = applyMyVote(base, track("b", { votedByMe: true }));

    expect(applyMyVote(votedB, track("b", { votedByMe: true }))).toBe(votedB);
  });

  it("works whichever comes first: the server's answer or the snapshot with the new count", () => {
    const answer = track("b", { voteCount: 2, votedByMe: true });
    const after = snapshot(2, [
      track("b", { voteCount: 2 }),
      track("a", { voteCount: 2 }),
    ]);

    const answerFirst = applySnapshot(applyMyVote(base, answer), after);
    const snapshotFirst = applyMyVote(applySnapshot(base, after), answer);

    expect(visibleTracks(answerFirst)).toEqual(visibleTracks(snapshotFirst));
    expect(voted(answerFirst)).toEqual(["b"]);
    expect(ids(answerFirst)).toEqual(["b", "a"]);
  });

  it("keeps a vote for a just-suggested track whose snapshot has not arrived yet", () => {
    const suggested = track("new", { votedByMe: true });
    const next = applySnapshot(
      applyMyVote(base, suggested),
      snapshot(2, [track("a"), track("b"), track("new")]),
    );

    expect(voted(next)).toEqual(["new"]);
  });
});
