import type { EventTrack, GeoPoint } from "@music-room/shared";
import { queuedTrackFrom } from "./messages";

export interface SuggestCalls {
  suggest(
    eventId: string,
    providerTrackId: string,
    location?: GeoPoint,
  ): Promise<EventTrack>;
  vote(eventId: string, trackId: string, location?: GeoPoint): Promise<EventTrack>;
}

/**
 * Suggest a track; it counts as my vote. If someone queued it first (409 TRACK_ALREADY_QUEUED, with
 * that track in the details), vote for it instead, as the contract suggests. Either way the answer
 * says whether I now vote for it. Any other failure is raised.
 */
export async function suggestOrVote(
  calls: SuggestCalls,
  eventId: string,
  providerTrackId: string,
  /** For a "place and time" event: sent with the suggestion and with the fallback vote. */
  location?: GeoPoint,
): Promise<{ track: EventTrack; alreadyQueued: boolean }> {
  try {
    return {
      track: await calls.suggest(eventId, providerTrackId, location),
      alreadyQueued: false,
    };
  } catch (error) {
    const queued = queuedTrackFrom(error);
    if (!queued) throw error;
    return { track: await calls.vote(eventId, queued.id, location), alreadyQueued: true };
  }
}
