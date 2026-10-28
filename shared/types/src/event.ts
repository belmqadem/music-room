// API contract: Event (Track Vote). Owner: belmqadem. Changes need review from BOTH developers.
// See docs/api-contract.md ("Events") and ADR-005.
import type { VoteLicense, MyPermissions } from "./license";
import type { Track } from "./track";
import type { Visibility } from "./visibility";

export interface MusicEvent {
  id: string; // UUID
  name: string;
  ownerId: string; // User id
  visibility: Visibility;
  voteLicense: VoteLicense;
  createdAt: string; // ISO 8601 UTC
  myPermissions: MyPermissions;
}

export interface CreateEventRequest {
  name: string;
  visibility?: Visibility; // default "public"
  voteLicense?: VoteLicense; // default { type: "everyone" }
}

/** All fields optional; at least one must be present. */
export interface UpdateEventRequest {
  name?: string;
  visibility?: Visibility;
  voteLicense?: VoteLicense;
}

/**
 * GET /events/nearby: a public "At the venue" room near a point, for the app to tell you about
 * it when you get there (ADR-052). Only public rooms, never yours, and only while their window is
 * on or starts within the next 12 hours.
 */
export interface NearbyEvent {
  event: MusicEvent; // voteLicense is always location_time: the venue and the window
  distanceMeters: number; // from the point asked about to the venue's center, rounded
  /** The kind of music: the track playing (if any), then the top of Up next; at most 3. */
  tracks: Track[];
}

/** The nearest first, at most 20 (the most regions iOS watches for one app). */
export interface NearbyEventsResponse {
  items: NearbyEvent[];
}
