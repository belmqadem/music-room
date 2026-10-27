import * as Location from "expo-location";
import { Platform } from "react-native";

// The name the phone knows the "rooms near you" regions by (ADR-052). Kept apart from the rest of
// the feature so sign-out can stop watching without importing the API client (which imports auth).
export const NEARBY_TASK = "nearby-rooms";

/** Stops watching every region. Sign-out calls it: the next person starts with it off. */
export async function stopWatchingRooms(): Promise<void> {
  if (Platform.OS === "web") return;
  if (await Location.hasStartedGeofencingAsync(NEARBY_TASK)) {
    await Location.stopGeofencingAsync(NEARBY_TASK);
  }
}
