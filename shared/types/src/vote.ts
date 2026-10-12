// API contract: Track Vote queue and voting. Owner: belmqadem. Changes need review from BOTH developers.
// See docs/api-contract.md ("Events", "Ranking and concurrency") and ADR-008.
import type { GeoPoint } from "./license";
import type { Track } from "./track";

/** One track in an event's queue. */
export interface EventTrack {
  id: string; // UUID of this queue entry
  eventId: string;
  track: Track;
  suggestedBy: string; // User id
  voteCount: number;
  /** Whether the caller has voted for this track. */
  votedByMe: boolean;
  status: "queued" | "playing" | "played";
  suggestedAt: string; // ISO 8601 UTC
}

export interface SuggestTrackRequest {
  providerTrackId: string;
  location?: GeoPoint; // required when the event's license is location_time
}

export interface VoteRequest {
  location?: GeoPoint; // required when the event's license is location_time
}

/** Socket.io `event:queue`: the full queue, already ordered, with absolute counts. */
export interface EventQueueUpdate {
  eventId: string;
  /**
   * Grows by at least 1 with every change to the queue (suggestion, vote, advance).
   * Apply a snapshot only if its version is higher than the one you hold: snapshots
   * can arrive late or out of order. (Proposed, see ADR-016.)
   */
  version: number;
  /** `playing` first, then `queued` ranked; `played` tracks are history and not included. */
  tracks: EventTrack[];
}

/** Body of POST /events/{id}/queue/advance (owner only). */
export interface AdvanceQueueRequest {
  /**
   * The track the app believes is playing now, or null if none. If it is not
   * the one playing, the answer is 409 QUEUE_CHANGED: this is what stops a
   * double tap from skipping a song.
   */
  currentTrackId: string | null;
}
