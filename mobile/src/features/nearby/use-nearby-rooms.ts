import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";
import { roomToOpen } from "./nearby-rooms";
import { nearbySupported, refreshNearbyOnOpen } from "./nearby-native";

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

    const open = (response: Notifications.NotificationResponse) => {
      const eventId = roomToOpen(response.notification.request.content.data);
      if (eventId) router.push(`/event/${eventId}`);
      // Handled once: a later reopening of the app doesn't open the room again.
      void Notifications.clearLastNotificationResponseAsync();
    };
    void Notifications.getLastNotificationResponseAsync().then((last) => {
      if (last) open(last);
    });
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, []);
}
