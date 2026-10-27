import type { LocationTimeRule, NearbyEvent } from "@music-room/shared";
import { copy } from "@/copy";

// Rooms near you (ADR-052), the decisions with no phone APIs in them: which circles to watch,
// whether a room is worth a notification, and what the notification says. Tested on their own.

/** iOS watches at most 20 regions per app: 19 rooms and the area around where you were. */
export const MAX_ROOM_REGIONS = 19;
/** The region that, once left, means "you moved: look for rooms again". */
export const MOVED_REGION_ID = "moved-away";
/** Half the server's 10 km search: leaving it, rooms further out may now be the nearest. */
export const MOVED_RADIUS_METERS = 5_000;
/** Phones notice a smaller circle late or not at all; a small venue is watched a bit wider. */
export const MIN_REGION_RADIUS_METERS = 150;

/** A circle for the phone to watch (the shape of expo-location's LocationRegion). */
export interface WatchedRegion {
  identifier: string;
  latitude: number;
  longitude: number;
  radius: number;
  notifyOnEnter: boolean;
  notifyOnExit: boolean;
}

export interface Point {
  latitude: number;
  longitude: number;
}

/** The venue and window of a nearby room (the server only returns "At the venue" rooms). */
export function venueOf(item: NearbyEvent): LocationTimeRule | null {
  const license = item.event.voteLicense;
  return license.type === "location_time" ? license : null;
}

export const regionRadius = (venue: LocationTimeRule): number =>
  Math.max(venue.radiusMeters, MIN_REGION_RADIUS_METERS);

/**
 * The circles to watch: each room's venue (entering it is what counts), then the area around
 * `origin`, where the list was fetched (leaving it is what counts).
 */
export function regionsFor(items: NearbyEvent[], origin: Point): WatchedRegion[] {
  const rooms: WatchedRegion[] = [];
  for (const item of items) {
    const venue = venueOf(item);
    if (!venue || rooms.length === MAX_ROOM_REGIONS) continue;
    rooms.push({
      identifier: item.event.id,
      latitude: venue.latitude,
      longitude: venue.longitude,
      radius: regionRadius(venue),
      notifyOnEnter: true,
      notifyOnExit: false,
    });
  }
  return [
    ...rooms,
    {
      identifier: MOVED_REGION_ID,
      latitude: origin.latitude,
      longitude: origin.longitude,
      radius: MOVED_RADIUS_METERS,
      notifyOnEnter: false,
      notifyOnExit: true,
    },
  ];
}

/** Whether the point the list was fetched for is already inside the room's watched circle. */
export function isWithin(item: NearbyEvent): boolean {
  const venue = venueOf(item);
  return venue !== null && item.distanceMeters <= regionRadius(venue);
}

/**
 * Rooms already notified, each with the end of the window it was notified for: one notification
 * per room and window. A room that runs again later (a new window) is a new notification.
 */
export type NotifiedRooms = Record<string, string>;

const windowKey = (item: NearbyEvent, venue: LocationTimeRule) =>
  `${item.event.id}@${venue.startsAt}`;

export function shouldNotify(
  item: NearbyEvent,
  notified: NotifiedRooms,
  now: Date,
): boolean {
  const venue = venueOf(item);
  if (!venue) return false;
  if (Date.parse(venue.endsAt) <= now.getTime()) return false;
  return !(windowKey(item, venue) in notified);
}

export function markNotified(
  notified: NotifiedRooms,
  item: NearbyEvent,
  now: Date,
): NotifiedRooms {
  const venue = venueOf(item);
  if (!venue) return notified;
  // Windows that are over can never be notified again: forget them, so the record stays small.
  const kept = Object.fromEntries(
    Object.entries(notified).filter(([, endsAt]) => Date.parse(endsAt) > now.getTime()),
  );
  return { ...kept, [windowKey(item, venue)]: venue.endsAt };
}

/** Up to three artists, each once, in the queue's order. */
export function artistsOf(item: NearbyEvent): string[] {
  return [...new Set(item.tracks.map((track) => track.artist))].slice(0, 3);
}

export interface RoomNotification {
  title: string;
  body: string;
  /** What a tap opens. */
  eventId: string;
}

/** What the notification says: the room, when it's on, its music, and what a tap does. */
export function notificationFor(
  item: NearbyEvent,
  now: Date,
  formatTime: (iso: string) => string,
): RoomNotification {
  const venue = venueOf(item);
  const { name } = item.event;
  const startsLater = venue !== null && Date.parse(venue.startsAt) > now.getTime();
  const artists = artistsOf(item);
  const music =
    artists.length > 0
      ? copy.nearby.notification.music(artists)
      : copy.nearby.notification.emptyQueue;
  return {
    title: startsLater
      ? copy.nearby.notification.startsAt(name, formatTime(venue.startsAt))
      : copy.nearby.notification.onNow(name),
    body: `${music} ${copy.nearby.notification.tapToOpen}`,
    eventId: item.event.id,
  };
}

const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The room a tapped notification opens: only ours carry an `eventId`, and it must be a room id. */
export function roomToOpen(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const id: unknown = (data as Record<string, unknown>)["eventId"];
  return typeof id === "string" && EVENT_ID.test(id) ? id : null;
}

/** A tap opens its room once: only a notification shown after the last one handled counts. */
export function isNewTap(shownAt: number, lastOpenedAt: number): boolean {
  return Number.isFinite(shownAt) && shownAt > lastOpenedAt;
}
