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
  tracks: EventTrack[];
}
