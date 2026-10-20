import type {
  EventQueueUpdate,
  EventTrack,
  QueueEntry,
  QueueSnapshot,
} from "@music-room/shared";

// An event's queue as this phone shows it (ADR-034). The server is the only authority: the app never
// re-sorts, never counts votes itself, and never shows a change before the server has made it.
// Two rules make late or out-of-order messages harmless:
//  1. A queue (from REST, the subscribe acknowledgement or the socket) replaces the one held only if
//     its `version` is higher. Messages can arrive late; an older queue would undo newer changes.
//  2. The socket's snapshots are the same for everybody, so they do not say which tracks I voted for
//     (ADR-019). My own votes are kept apart and merged into whatever queue is shown.

export interface QueueState {
  /** -1 until the first queue arrives. */
  version: number;
  /** The server's order: the playing track first, then the queued ones ranked. */
  entries: QueueEntry[];
  /** Queue-entry ids I voted for, as the server last told me. */
  myVotes: ReadonlySet<string>;
}

export const EMPTY_QUEUE: QueueState = { version: -1, entries: [], myVotes: new Set() };

/** A queue as I see it (REST, subscribe acknowledgement, advance): it carries my votes too. */
export function applyMyQueue(state: QueueState, update: EventQueueUpdate): QueueState {
  if (update.version <= state.version) return state;
  return {
    version: update.version,
    entries: update.tracks.map(withoutMyVote),
    myVotes: new Set(update.tracks.filter((t) => t.votedByMe).map((t) => t.id)),
  };
}

/** A socket snapshot: the same for everybody, so my votes are kept from before. */
export function applySnapshot(state: QueueState, snapshot: QueueSnapshot): QueueState {
  if (snapshot.version <= state.version) return state;
  return { ...state, version: snapshot.version, entries: snapshot.tracks };
}

/**
 * The answer to my vote, withdrawal or suggestion: it says whether I now vote for that track. Only
 * that mark changes; counts and order wait for the next queue from the server.
 */
export function applyMyVote(state: QueueState, track: EventTrack): QueueState {
  if (state.myVotes.has(track.id) === track.votedByMe) return state;
  const myVotes = new Set(state.myVotes);
  if (track.votedByMe) myVotes.add(track.id);
  else myVotes.delete(track.id);
  return { ...state, myVotes };
}

/** The queue to show: the server's entries with my vote marks merged in. */
export function visibleTracks(state: QueueState): EventTrack[] {
  return state.entries.map((entry) => ({
    ...entry,
    votedByMe: state.myVotes.has(entry.id),
  }));
}

/** The track playing now, if any (the server puts it first). */
export function playingTrack(state: QueueState): EventTrack | null {
  const tracks = visibleTracks(state);
  return tracks.find((t) => t.status === "playing") ?? null;
}

function withoutMyVote({ votedByMe: _mine, ...entry }: EventTrack): QueueEntry {
  return entry;
}
