import type {
  CreateEventRequest,
  EventQueueUpdate,
  EventTrack,
  GeoPoint,
  MusicEvent,
  Page,
} from "@music-room/shared";
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
  /** The caller becomes the owner. */
  create: (request: CreateEventRequest) =>
    auth.request<MusicEvent>("POST", "/events", { body: request }),
  get: (eventId: string) => auth.request<MusicEvent>("GET", path(eventId)),
  /** The queue as I see it (with my votes), already ordered by the server. */
  queue: (eventId: string) =>
    auth.request<EventQueueUpdate>("GET", path(eventId, "/tracks")),
  /** Counts as my vote. 409 TRACK_ALREADY_QUEUED (with the queued track) if it is already queued. */
  suggest: (eventId: string, providerTrackId: string, location?: GeoPoint) =>
    auth.request<EventTrack>("POST", path(eventId, "/tracks"), {
      body: { providerTrackId, ...(location && { location }) },
    }),
  /** Idempotent: voting twice counts once. */
  /** `location` only for a "place and time" event that asked for it (LOCATION_REQUIRED). */
  vote: (eventId: string, trackId: string, location?: GeoPoint) =>
    auth.request<EventTrack>("PUT", trackVote(eventId, trackId), {
      ...(location && { body: { location } }),
    }),
  /** Idempotent, and allowed to anyone who can see the event (no license, no location). */
  withdraw: (eventId: string, trackId: string) =>
    auth.request<EventTrack>("DELETE", trackVote(eventId, trackId)),
  /** Owner only. `currentTrackId` is what this phone shows as playing: a stale one is 409 QUEUE_CHANGED. */
  advance: (eventId: string, currentTrackId: string | null) =>
    auth.request<EventQueueUpdate>("POST", path(eventId, "/queue/advance"), {
      body: { currentTrackId },
    }),
};
