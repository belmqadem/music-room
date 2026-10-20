import type { EventQueueUpdate, EventTrack, MusicEvent, Page } from "@music-room/shared";
import { auth } from "@/auth";

// The Track Vote endpoints (docs/api-contract.md, "Events"). The backend checks the access rules on
// every call; the app only shows what it answers.

const path = (eventId: string, rest = "") =>
  `/events/${encodeURIComponent(eventId)}${rest}`;
const trackVote = (eventId: string, trackId: string) =>
  path(eventId, `/tracks/${encodeURIComponent(trackId)}/vote`);

export const eventApi = {
  /** Public events, mine, and private ones I am invited to, newest first. */
  list: (cursor?: string) =>
    auth.request<Page<MusicEvent>>("GET", "/events", { query: { limit: 20, cursor } }),
  get: (eventId: string) => auth.request<MusicEvent>("GET", path(eventId)),
  /** The queue as I see it (with my votes), already ordered by the server. */
  queue: (eventId: string) =>
    auth.request<EventQueueUpdate>("GET", path(eventId, "/tracks")),
  /** Idempotent: voting twice counts once. */
  vote: (eventId: string, trackId: string) =>
    auth.request<EventTrack>("PUT", trackVote(eventId, trackId)),
  /** Idempotent, and allowed to anyone who can see the event (no license, no location). */
  withdraw: (eventId: string, trackId: string) =>
    auth.request<EventTrack>("DELETE", trackVote(eventId, trackId)),
  /** Owner only. `currentTrackId` is what this phone shows as playing: a stale one is 409 QUEUE_CHANGED. */
  advance: (eventId: string, currentTrackId: string | null) =>
    auth.request<EventQueueUpdate>("POST", path(eventId, "/queue/advance"), {
      body: { currentTrackId },
    }),
};
