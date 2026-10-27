import type { NearbyEventsResponse } from "@music-room/shared";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { api } from "@/api/client";
import { isRequestError } from "@/api/api-error";
import { copy } from "@/copy";
import { withTimeout } from "@/location/position-error";
import { offlineStore } from "@/offline";
import type { Point, WatchedRegion } from "./nearby-rooms";
import { NEARBY_TASK, stopWatchingRooms } from "./stop-watching";
import { createNearbyWatcher, type NearbyWatcher } from "./nearby-watcher";

// Rooms near you (ADR-052) on a real phone: the server, the phone's geofencing, its notifications
// and its position, plugged into the watcher. Not available on the web (no background tasks).

export const nearbySupported = Platform.OS !== "web";

const CHANNEL_ID = "nearby-rooms";
/** A position this recent is good enough to look for rooms within 10 km. */
const LAST_KNOWN_MAX_AGE_MS = 5 * 60 * 1000;
const POSITION_TIMEOUT_MS = 15_000;

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

async function currentPoint(): Promise<Point | null> {
  try {
    const last = await Location.getLastKnownPositionAsync({
      maxAge: LAST_KNOWN_MAX_AGE_MS,
    });
    const reading =
      last ??
      (await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        POSITION_TIMEOUT_MS,
      ));
    return { latitude: reading.coords.latitude, longitude: reading.coords.longitude };
  } catch (error) {
    console.warn("Rooms near you: no position:", error);
    return null;
  }
}

/** Android 8+ shows a notification only on a channel; Android 13 asks only once one exists. */
async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: copy.nearby.channel,
    importance: Notifications.AndroidImportance.HIGH,
  });
}

export const nearbyWatcher: NearbyWatcher = createNearbyWatcher({
  async fetchNearby(point) {
    const response = await api.get<NearbyEventsResponse>("/events/nearby", {
      query: { latitude: point.latitude, longitude: point.longitude },
    });
    return response.items;
  },
  store: offlineStore,
  geofences: {
    watch: (regions) => Location.startGeofencingAsync(NEARBY_TASK, regions),
    stop: stopWatchingRooms,
  },
  async notify(notification) {
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      // One per room: a second one for the same room replaces the first.
      identifier: `nearby-${notification.eventId}`,
      content: {
        title: notification.title,
        body: notification.body,
        data: { eventId: notification.eventId },
      },
      trigger: Platform.OS === "android" ? { channelId: CHANNEL_ID } : null,
    });
  },
  currentPoint,
  now: () => new Date(),
  formatTime: (iso) => timeFormat.format(new Date(iso)),
});

interface GeofencingTaskData {
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
}

// The phone runs this when a watched region is entered or left, the app open or in the
// background. It must be defined when the bundle loads (TaskManager's rule): the root layout
// imports this file.
if (nearbySupported) {
  TaskManager.defineTask<GeofencingTaskData>(NEARBY_TASK, async ({ data, error }) => {
    if (error) {
      console.warn("Rooms near you: geofencing error:", error.message);
      return;
    }
    const { region, eventType } = data;
    try {
      await nearbyWatcher.handleRegionEvent({
        type: eventType === Location.GeofencingEventType.Enter ? "enter" : "exit",
        region: {
          identifier: region.identifier ?? "",
          latitude: region.latitude,
          longitude: region.longitude,
          radius: region.radius,
          notifyOnEnter: region.notifyOnEnter ?? true,
          notifyOnExit: region.notifyOnExit ?? true,
        } satisfies WatchedRegion,
      });
    } catch (failure) {
      console.warn("Rooms near you: couldn't handle a region event:", failure);
    }
  });

  // A notification that arrives while the app is open is shown too.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export type EnableOutcome =
  | "on"
  | "servicesOff"
  | "locationDenied"
  | "alwaysDenied"
  | "notificationsDenied"
  | "noPosition"
  | "noConnection";

/**
 * Turning it on: location, then location all the time (the system can't give the second without
 * the first), then notifications, then the first list. Anything refused leaves it off.
 */
export async function enableNearby(): Promise<EnableOutcome> {
  if (!(await Location.hasServicesEnabledAsync())) return "servicesOff";
  if (!(await Location.requestForegroundPermissionsAsync()).granted)
    return "locationDenied";
  if (!(await Location.requestBackgroundPermissionsAsync()).granted)
    return "alwaysDenied";
  await ensureChannel();
  if (!(await Notifications.requestPermissionsAsync()).granted)
    return "notificationsDenied";
  const point = await currentPoint();
  if (!point) return "noPosition";
  try {
    await nearbyWatcher.enable(point);
    return "on";
  } catch (error) {
    if (isRequestError(error) && error.code === "NETWORK_ERROR") return "noConnection";
    throw error;
  }
}

/**
 * On opening the app: if it's on and still allowed, look again (rooms change, and the phone may
 * have moved). If "all the time" was taken away in the phone's settings, it turns itself off.
 */
export async function refreshNearbyOnOpen(): Promise<void> {
  if (!nearbySupported || !(await nearbyWatcher.isEnabled())) return;
  if (!(await Location.getBackgroundPermissionsAsync()).granted) {
    await nearbyWatcher.disable();
    return;
  }
  await nearbyWatcher.refresh();
}
