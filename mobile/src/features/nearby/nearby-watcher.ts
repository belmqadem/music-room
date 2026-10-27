import type { NearbyEvent } from "@music-room/shared";
import { isRequestError } from "@/api/api-error";
import type { OfflineStore } from "@/offline/offline-store";
import {
  isWithin,
  markNotified,
  MOVED_REGION_ID,
  notificationFor,
  regionsFor,
  shouldNotify,
  type NotifiedRooms,
  type Point,
  type RoomNotification,
  type WatchedRegion,
} from "./nearby-rooms";

// Rooms near you (ADR-052): what happens when you turn it on, when the phone says you entered a
// venue or left the area, and when you turn it off. The phone's APIs come in as dependencies
// (nearby-native.ts wires the real ones), so every path is tested without a phone.
//
// Kept in the offline store, which sign-out wipes (ADR-049): whether it is on (so the next person
// to sign in on this phone starts with it off), the last list, and the rooms already notified.

export interface NearbyWatcherDeps {
  /** GET /events/nearby: public "At the venue" rooms near the point, nearest first. */
  fetchNearby(point: Point): Promise<NearbyEvent[]>;
  store: Pick<OfflineStore, "read" | "write" | "remove">;
  geofences: {
    /** Replaces every watched region with these. */
    watch(regions: WatchedRegion[]): Promise<void>;
    stop(): Promise<void>;
  };
  notify(notification: RoomNotification): Promise<void>;
  /** Where the phone is now, or null if it can't tell. */
  currentPoint(): Promise<Point | null>;
  now(): Date;
  formatTime(iso: string): string;
}

/** What the phone reported about one of the watched regions. */
export interface RegionEvent {
  type: "enter" | "exit";
  region: WatchedRegion;
}

const ENABLED = "nearby:enabled";
const ROOMS = "nearby:rooms";
const NOTIFIED = "nearby:notified";

export function createNearbyWatcher(deps: NearbyWatcherDeps) {
  // Two regions can be entered at the same moment: notifying one after the other keeps the
  // "already notified" record from losing one of them.
  let notifying: Promise<unknown> = Promise.resolve();

  function notifyOnce(item: NearbyEvent): Promise<void> {
    const run = async () => {
      const now = deps.now();
      const notified = (await deps.store.read<NotifiedRooms>(NOTIFIED))?.data ?? {};
      if (!shouldNotify(item, notified, now)) return;
      await deps.notify(notificationFor(item, now, deps.formatTime));
      await deps.store.write(NOTIFIED, markNotified(notified, item, now));
    };
    const next = notifying.then(run, run);
    notifying = next.catch(() => undefined);
    return next;
  }

  /** Asks the server for rooms near `point`, watches them, and notifies the ones you're in. */
  async function refreshAt(point: Point): Promise<NearbyEvent[]> {
    const items = await deps.fetchNearby(point);
    await deps.store.write(ROOMS, items);
    await deps.geofences.watch(regionsFor(items, point));
    for (const item of items) if (isWithin(item)) await notifyOnce(item);
    return items;
  }

  async function isEnabled(): Promise<boolean> {
    return (await deps.store.read<boolean>(ENABLED))?.data === true;
  }

  /** The list is fetched, and the circles watched, before it counts as on. */
  async function enable(point: Point): Promise<void> {
    await refreshAt(point);
    await deps.store.write(ENABLED, true);
  }

  async function disable(): Promise<void> {
    await deps.geofences.stop();
    await deps.store.remove(ENABLED);
    await deps.store.remove(ROOMS);
  }

  /** On opening the app: rooms change, so the list is fetched again. Returns false if it couldn't. */
  async function refresh(): Promise<boolean> {
    if (!(await isEnabled())) return false;
    const point = await deps.currentPoint();
    if (!point) return false;
    await refreshAt(point);
    return true;
  }

  async function handleRegionEvent(event: RegionEvent): Promise<void> {
    // Turned off, or signed out, while the phone still watched: stop, and say nothing.
    if (!(await isEnabled())) {
      await deps.geofences.stop();
      return;
    }
    const { region } = event;
    if (region.identifier === MOVED_REGION_ID) {
      if (event.type === "exit") await refresh();
      return;
    }
    if (event.type !== "enter") return;
    // You are at this venue: ask the server again from there, so a room deleted or made private
    // since the last list is not announced. If it is still listed, refreshAt notifies it (you are
    // at its center); if not, it is over, private or gone, and there is nothing to say.
    try {
      await refreshAt(region);
      return;
    } catch (error) {
      // Only "no answer" falls back to the last list. A refusal is the server's last word.
      if (!(isRequestError(error) && error.code === "NETWORK_ERROR")) throw error;
      console.warn("Rooms near you: server unreachable, using the last list.");
    }
    // Offline: the last list was public when it was fetched, and a tap still asks the server.
    const cached = (await deps.store.read<NearbyEvent[]>(ROOMS))?.data ?? [];
    const item = cached.find((candidate) => candidate.event.id === region.identifier);
    if (item) await notifyOnce(item);
  }

  return { isEnabled, enable, disable, refresh, handleRegionEvent };
}

export type NearbyWatcher = ReturnType<typeof createNearbyWatcher>;
