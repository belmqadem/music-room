import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";
import { isNewTap, roomToOpen } from "./nearby-rooms";
import { nearbySupported, refreshNearbyOnOpen } from "./nearby-native";

// When the last tap handled was shown, so each notification opens its room once: the phone can
// hand the same tap back later (to the listener and to "last response", or after signing in
// again). Only a time, no room: it is kept across sign-out on purpose, so an old tap stays old.
const LAST_OPENED_KEY = "nearby.lastOpenedNotificationAt";

async function readLastOpened(): Promise<number> {
  try {
    return Number((await AsyncStorage.getItem(LAST_OPENED_KEY)) ?? 0);
  } catch (error) {
    console.warn("Rooms near you: couldn't read the last tap handled:", error);
    return 0;
  }
}

// One tap at a time: the listener and "last response" can report the same tap together.
let handling: Promise<void> = Promise.resolve();

function openOnce(response: Notifications.NotificationResponse): void {
  handling = handling
    .then(async () => {
      const shownAt = response.notification.date;
      if (!isNewTap(shownAt, await readLastOpened())) return;
      const eventId = roomToOpen(response.notification.request.content.data);
      if (eventId) router.push(`/event/${eventId}`);
      await AsyncStorage.setItem(LAST_OPENED_KEY, String(shownAt));
    })
    // A failed tap must not block the next ones.
    .catch((error: unknown) =>
      console.warn("Rooms near you: couldn't open a tap:", error),
    );
}

/**
 * While signed in (ADR-052): look for rooms near you again on opening the app, and open the room
 * whose notification was tapped, including the tap that started the app. The room screen asks the
 * server as usual, so a room that went private or was deleted since shows its usual error.
 */
export function useNearbyRooms(): void {
  useEffect(() => {
    if (!nearbySupported) return;
    refreshNearbyOnOpen().catch((error: unknown) =>
      console.warn("Rooms near you: couldn't look again on opening:", error),
    );

    void Notifications.getLastNotificationResponseAsync().then((last) => {
      if (last) openOnce(last);
    });
    const subscription = Notifications.addNotificationResponseReceivedListener(openOnce);
    return () => subscription.remove();
  }, []);
}
