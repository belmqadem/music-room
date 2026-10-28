import type { NearbyEvent, Track } from "@music-room/shared";
import { describe, expect, it, vi } from "vitest";
import { RequestError } from "@/api/api-error";
import { enableProblemMessage, needsPhoneSettings } from "@/features/nearby/messages";
import {
  artistsOf,
  isNewTap,
  isWithin,
  markNotified,
  MAX_ROOM_REGIONS,
  MIN_REGION_RADIUS_METERS,
  MOVED_RADIUS_METERS,
  MOVED_REGION_ID,
  notificationFor,
  regionsFor,
  roomToOpen,
  shouldNotify,
  type WatchedRegion,
} from "@/features/nearby/nearby-rooms";
import {
  createNearbyWatcher,
  type NearbyWatcherDeps,
} from "@/features/nearby/nearby-watcher";
import { createOfflineStore, type KeyValueStorage } from "@/offline/offline-store";

// Rooms near you (ADR-052): which circles the phone watches, when a room is announced (once per
// room and window), what the notification says, and what happens on entering a venue, leaving the
// area, turning it on and off.

const NOW = new Date("2026-10-27T20:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();
const HERE = { latitude: 48.8966, longitude: 2.3185 };

let nextId = 1;
const roomId = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;

function track(artist: string, title = "Song"): Track {
  return { providerTrackId: title, title, artist, durationSeconds: 180, coverUrl: null };
}

function room(
  options: {
    id?: string;
    name?: string;
    distanceMeters?: number;
    radiusMeters?: number;
    startsAt?: string;
    endsAt?: string;
    tracks?: Track[];
  } = {},
): NearbyEvent {
  return {
    event: {
      id: options.id ?? roomId(),
      name: options.name ?? "Friday night",
      ownerId: "owner",
      visibility: "public",
      voteLicense: {
        type: "location_time",
        latitude: 48.9,
        longitude: 2.32,
        radiusMeters: options.radiusMeters ?? 200,
        startsAt: options.startsAt ?? at(-HOUR),
        endsAt: options.endsAt ?? at(2 * HOUR),
      },
      createdAt: at(-24 * HOUR),
      myPermissions: { canView: true, canAct: true, canManage: false },
    },
    distanceMeters: options.distanceMeters ?? 1_000,
    tracks: options.tracks ?? [],
  };
}

describe("the circles the phone watches", () => {
  it("watches each venue for entering, and the area you were in for leaving", () => {
    const venue = room({ radiusMeters: 400 });

    const regions = regionsFor([venue], HERE);

    expect(regions).toEqual([
      {
        identifier: venue.event.id,
        latitude: 48.9,
        longitude: 2.32,
        radius: 400,
        notifyOnEnter: true,
        notifyOnExit: false,
      },
      {
        identifier: MOVED_REGION_ID,
        ...HERE,
        radius: MOVED_RADIUS_METERS,
        notifyOnEnter: false,
        notifyOnExit: true,
      },
    ]);
  });

  it("watches a small venue a bit wider, since phones notice small circles late", () => {
    const [region] = regionsFor([room({ radiusMeters: 20 })], HERE);

    expect(region?.radius).toBe(MIN_REGION_RADIUS_METERS);
  });

  it("watches at most 19 rooms plus the area: the 20 regions iOS allows", () => {
    const items = Array.from({ length: 25 }, () => room());

    const regions = regionsFor(items, HERE);

    expect(regions).toHaveLength(MAX_ROOM_REGIONS + 1);
    expect(regions.slice(0, -1).map((r) => r.identifier)).toEqual(
      items.slice(0, MAX_ROOM_REGIONS).map((item) => item.event.id),
    );
    expect(regions.at(-1)?.identifier).toBe(MOVED_REGION_ID);
  });

  it("with no rooms, still watches the area, to look again once you move", () => {
    expect(regionsFor([], HERE).map((r) => r.identifier)).toEqual([MOVED_REGION_ID]);
  });

  it("knows when the point asked about is already within a room's circle", () => {
    expect(isWithin(room({ distanceMeters: 150, radiusMeters: 200 }))).toBe(true);
    expect(isWithin(room({ distanceMeters: 201, radiusMeters: 200 }))).toBe(false);
    // The watched circle is at least 150 m, so 120 m from a 20 m venue counts.
    expect(isWithin(room({ distanceMeters: 120, radiusMeters: 20 }))).toBe(true);
  });
});

describe("one notification per room and window", () => {
  it("notifies a room on now, or starting later, that wasn't notified yet", () => {
    expect(shouldNotify(room(), {}, NOW)).toBe(true);
    expect(
      shouldNotify(room({ startsAt: at(3 * HOUR), endsAt: at(5 * HOUR) }), {}, NOW),
    ).toBe(true);
  });

  it("never notifies a room whose window is over (it ends at endsAt)", () => {
    expect(shouldNotify(room({ startsAt: at(-3 * HOUR), endsAt: at(0) }), {}, NOW)).toBe(
      false,
    );
  });

  it("doesn't notify the same room and window twice", () => {
    const item = room();
    const notified = markNotified({}, item, NOW);

    expect(shouldNotify(item, notified, NOW)).toBe(false);
    expect(shouldNotify(room(), notified, NOW)).toBe(true);
  });

  it("notifies the same room again for a new window", () => {
    const id = roomId();
    const tonight = room({ id });
    const notified = markNotified({}, tonight, NOW);

    const tomorrow = room({ id, startsAt: at(20 * HOUR), endsAt: at(24 * HOUR) });

    expect(shouldNotify(tomorrow, notified, NOW)).toBe(true);
  });

  it("forgets windows that are over, so the record stays small", () => {
    const old = room({ startsAt: at(-5 * HOUR), endsAt: at(-HOUR) });
    const stale = { [`${old.event.id}@${at(-5 * HOUR)}`]: at(-HOUR) };
    const item = room();

    expect(Object.keys(markNotified(stale, item, NOW))).toEqual([
      `${item.event.id}@${at(-HOUR)}`,
    ]);
  });
});

describe("what the notification says", () => {
  const formatTime = (iso: string) => `[${iso.slice(11, 16)}]`;

  it("a room on now, with its music and what a tap does", () => {
    const item = room({
      name: "Rooftop",
      tracks: [track("Daft Punk"), track("Justice"), track("Daft Punk", "Again")],
    });

    expect(notificationFor(item, NOW, formatTime)).toEqual({
      title: "Rooftop is on near you",
      body: "Music from Daft Punk and Justice. Tap to open the room and vote.",
      eventId: item.event.id,
    });
  });

  it("a room starting later says when, in the phone's time", () => {
    const item = room({
      name: "Rooftop",
      startsAt: "2026-10-27T22:30:00.000Z",
      endsAt: at(5 * HOUR),
    });

    expect(notificationFor(item, NOW, formatTime).title).toBe(
      "Rooftop starts at [22:30] near you",
    );
  });

  it("a room with an empty queue says so", () => {
    expect(notificationFor(room(), NOW, formatTime).body).toBe(
      "The queue's empty so far. Tap to open the room and vote.",
    );
  });

  it("names up to three artists, each once, in the queue's order", () => {
    const item = room({
      tracks: ["A", "B", "A", "C", "D"].map((artist) => track(artist)),
    });

    expect(artistsOf(item)).toEqual(["A", "B", "C"]);
    expect(notificationFor(item, NOW, formatTime).body).toMatch(
      /^Music from A, B and C\./,
    );
    expect(
      notificationFor(room({ tracks: [track("Solo")] }), NOW, formatTime).body,
    ).toMatch(/^Music from Solo\./);
  });
});

describe("opening a room from a tapped notification", () => {
  it("opens the room the notification names", () => {
    const id = roomId();
    expect(roomToOpen({ eventId: id })).toBe(id);
  });

  it.each([
    ["no data", null],
    ["another kind of notification", { other: "x" }],
    ["a path instead of an id", { eventId: "../settings" }],
    ["a number", { eventId: 42 }],
  ])("opens nothing for %s", (_label, data) => {
    expect(roomToOpen(data)).toBeNull();
  });
});

describe("each tap opens its room once", () => {
  it("opens a notification shown after the last one handled", () => {
    expect(isNewTap(2_000, 1_000)).toBe(true);
    expect(isNewTap(1_000, 0)).toBe(true);
  });

  it("ignores the same tap handed back again, or an older one", () => {
    expect(isNewTap(1_000, 1_000)).toBe(false);
    expect(isNewTap(500, 1_000)).toBe(false);
  });

  it("ignores a tap without a time", () => {
    expect(isNewTap(Number.NaN, 0)).toBe(false);
  });
});

describe("when turning it on doesn't work", () => {
  it("says what is missing, and sends to the phone's settings only when needed", () => {
    expect(enableProblemMessage("alwaysDenied")).toContain("Allow all the time");
    expect(needsPhoneSettings("alwaysDenied")).toBe(true);
    expect(needsPhoneSettings("notificationsDenied")).toBe(true);
    expect(needsPhoneSettings("locationDenied")).toBe(true);
    expect(needsPhoneSettings("servicesOff")).toBe(false);
    expect(needsPhoneSettings("noConnection")).toBe(false);
    expect(needsPhoneSettings("noPosition")).toBe(false);
  });
});

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
    getAllKeys: async () => [...map.keys()],
    multiRemove: async (keys) => keys.forEach((k) => map.delete(k)),
  };
}

function setup(rooms: NearbyEvent[] = []) {
  const store = createOfflineStore(memoryStorage(), () => NOW);
  let list = rooms;
  const deps = {
    fetchNearby: vi.fn(async () => list),
    store,
    geofences: { watch: vi.fn(async () => {}), stop: vi.fn(async () => {}) },
    notify: vi.fn(async () => {}),
    currentPoint: vi.fn<NearbyWatcherDeps["currentPoint"]>(async () => HERE),
    now: () => NOW,
    formatTime: () => "21:00",
  } satisfies NearbyWatcherDeps;
  const watcher = createNearbyWatcher(deps);
  return {
    deps,
    store,
    watcher,
    setList: (next: NearbyEvent[]) => void (list = next),
  };
}

const regionOf = (item: NearbyEvent): WatchedRegion => regionsFor([item], HERE)[0]!;
const enter = (region: WatchedRegion) => ({ type: "enter" as const, region });
const movedArea: WatchedRegion = {
  identifier: MOVED_REGION_ID,
  ...HERE,
  radius: MOVED_RADIUS_METERS,
  notifyOnEnter: false,
  notifyOnExit: true,
};

describe("turning it on and off", () => {
  it("is off until turned on", async () => {
    const { watcher } = setup();

    expect(await watcher.isEnabled()).toBe(false);
  });

  it("turning on fetches the rooms near you, watches them, and only then counts as on", async () => {
    const far = room({ distanceMeters: 3_000 });
    const { deps, watcher } = setup([far]);

    await watcher.enable(HERE);

    expect(deps.fetchNearby).toHaveBeenCalledWith(HERE);
    expect(deps.geofences.watch).toHaveBeenCalledWith(regionsFor([far], HERE));
    expect(await watcher.isEnabled()).toBe(true);
    // Not there yet: nothing to say.
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("stays off if the server can't be reached", async () => {
    const { deps, watcher } = setup();
    deps.fetchNearby.mockRejectedValueOnce(new RequestError(0, "NETWORK_ERROR", "x"));

    await expect(watcher.enable(HERE)).rejects.toThrow();
    expect(await watcher.isEnabled()).toBe(false);
    expect(deps.geofences.watch).not.toHaveBeenCalled();
  });

  it("notifies right away a room you're already at when turning on, once", async () => {
    const here = room({ distanceMeters: 50 });
    const { deps, watcher } = setup([here]);

    await watcher.enable(HERE);
    await watcher.refresh();

    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: here.event.id }),
    );
  });

  it("turning off stops watching and forgets the list", async () => {
    const { deps, store, watcher } = setup([room()]);
    await watcher.enable(HERE);

    await watcher.disable();

    expect(deps.geofences.stop).toHaveBeenCalled();
    expect(await watcher.isEnabled()).toBe(false);
    expect(await store.read("nearby:rooms")).toBeNull();
  });

  it("looking again on opening the app does nothing while it's off", async () => {
    const { deps, watcher } = setup([room()]);

    expect(await watcher.refresh()).toBe(false);
    expect(deps.fetchNearby).not.toHaveBeenCalled();
  });

  it("looking again needs a position; without one it says so and changes nothing", async () => {
    const { deps, watcher } = setup([room()]);
    await watcher.enable(HERE);
    deps.currentPoint.mockResolvedValueOnce(null);

    expect(await watcher.refresh()).toBe(false);
    expect(deps.fetchNearby).toHaveBeenCalledTimes(1);
  });
});

describe("when the phone reports a region", () => {
  it("entering a venue asks the server again from there, and notifies the room", async () => {
    const venue = room({ distanceMeters: 3_000 });
    const { deps, setList, watcher } = setup([venue]);
    await watcher.enable(HERE);
    // From the venue itself, the server measures you at its center.
    setList([{ ...venue, distanceMeters: 0 }]);

    await watcher.handleRegionEvent(enter(regionOf(venue)));

    expect(deps.fetchNearby).toHaveBeenLastCalledWith(regionOf(venue));
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: venue.event.id }),
    );
  });

  it("says nothing about a room the server no longer lists (private now, deleted or over)", async () => {
    const venue = room({ distanceMeters: 3_000 });
    const { deps, setList, watcher } = setup([venue]);
    await watcher.enable(HERE);
    setList([]);

    await watcher.handleRegionEvent(enter(regionOf(venue)));

    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("offline, uses the last list: the room was public when it was fetched", async () => {
    const venue = room({ distanceMeters: 3_000 });
    const { deps, watcher } = setup([venue]);
    await watcher.enable(HERE);
    deps.fetchNearby.mockRejectedValueOnce(new RequestError(0, "NETWORK_ERROR", "x"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await watcher.handleRegionEvent(enter(regionOf(venue)));

    expect(deps.notify).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: venue.event.id }),
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a refusal from the server is its last word: no fallback, and the error is raised", async () => {
    const venue = room({ distanceMeters: 3_000 });
    const { deps, watcher } = setup([venue]);
    await watcher.enable(HERE);
    deps.fetchNearby.mockRejectedValueOnce(new RequestError(401, "UNAUTHENTICATED", "x"));

    await expect(watcher.handleRegionEvent(enter(regionOf(venue)))).rejects.toThrow();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("entering the same venue again in the same window says nothing new", async () => {
    const venue = room({ distanceMeters: 0 });
    const { deps, watcher } = setup([venue]);
    await watcher.enable(HERE);

    await watcher.handleRegionEvent(enter(regionOf(venue)));
    await watcher.handleRegionEvent(enter(regionOf(venue)));

    expect(deps.notify).toHaveBeenCalledTimes(1);
  });

  it("standing at a venue: the phone's repeated 'entered' asks the server again but hands the same circles only once", async () => {
    const venue = room({ distanceMeters: 0 });
    const { deps, watcher } = setup([venue]);
    await watcher.enable(HERE);
    expect(deps.geofences.watch).toHaveBeenCalledTimes(1);

    // iOS reports "entered" again each time it is handed circles you're already in.
    await watcher.handleRegionEvent(enter(regionOf(venue)));
    await watcher.handleRegionEvent(enter(regionOf(venue)));
    await watcher.handleRegionEvent(enter(regionOf(venue)));

    // From the venue the area to leave is centered there: handed once, then never again.
    expect(deps.geofences.watch).toHaveBeenCalledTimes(2);
    expect(deps.geofences.watch).toHaveBeenLastCalledWith(
      regionsFor([venue], regionOf(venue)),
    );
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });

  it("hands the circles again when the list changes", async () => {
    const venue = room({ distanceMeters: 0 });
    const other = room({ distanceMeters: 2_000 });
    const { deps, setList, watcher } = setup([venue]);
    await watcher.enable(HERE);
    await watcher.handleRegionEvent(enter(regionOf(venue)));
    setList([venue, other]);

    await watcher.handleRegionEvent(enter(regionOf(venue)));

    expect(deps.geofences.watch).toHaveBeenLastCalledWith(
      regionsFor([venue, other], regionOf(venue)),
    );
  });

  it("after turning off and on, hands the circles again even if they are the same", async () => {
    const { deps, watcher } = setup([room({ distanceMeters: 3_000 })]);
    await watcher.enable(HERE);
    await watcher.disable();

    await watcher.enable(HERE);

    expect(deps.geofences.watch).toHaveBeenCalledTimes(2);
  });

  it("two venues entered at the same moment are both notified", async () => {
    const a = room({ distanceMeters: 0 });
    const b = room({ distanceMeters: 0 });
    const { deps, watcher } = setup([]);
    await watcher.enable(HERE);
    deps.fetchNearby.mockResolvedValue([a, b]);

    await Promise.all([
      watcher.handleRegionEvent(enter(regionOf(a))),
      watcher.handleRegionEvent(enter(regionOf(b))),
    ]);

    const notifiedIds = deps.notify.mock.calls.map(
      (call) => (call as unknown as [{ eventId: string }])[0].eventId,
    );
    expect(new Set(notifiedIds)).toEqual(new Set([a.event.id, b.event.id]));
    expect(notifiedIds).toHaveLength(2);
  });

  it("leaving the area you were in looks for rooms again from where you are now", async () => {
    const { deps, watcher } = setup([]);
    await watcher.enable(HERE);
    const elsewhere = { latitude: 48.95, longitude: 2.4 };
    deps.currentPoint.mockResolvedValueOnce(elsewhere);

    await watcher.handleRegionEvent({ type: "exit", region: movedArea });

    expect(deps.fetchNearby).toHaveBeenLastCalledWith(elsewhere);
    expect(deps.geofences.watch).toHaveBeenLastCalledWith(regionsFor([], elsewhere));
  });

  it("after turning off (or signing out), a region still reported is stopped, silently", async () => {
    const venue = room({ distanceMeters: 0 });
    const { deps, watcher } = setup([venue]);

    await watcher.handleRegionEvent(enter(regionOf(venue)));

    expect(deps.geofences.stop).toHaveBeenCalled();
    expect(deps.fetchNearby).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });
});
