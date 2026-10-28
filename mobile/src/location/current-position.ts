import type { GeoPoint } from "@music-room/shared";
import * as Location from "expo-location";
import { PositionUnavailableError, withTimeout } from "./position-error";
import { positionWithFallback, type PositionReading } from "./position-fallback";

export const POSITION_TIMEOUT_MS = 15_000;

/**
 * The phone's position, for a vote in a "place and time" event (docs/api-contract.md, Access
 * rules). Asked only when the server needs it; the permission is "while using the app". The
 * accuracy goes with it: the server refuses a position worse than 100 m. If no fresh fix comes in
 * time, a recent last known position is used (position-fallback.ts). Nothing is stored.
 */
export async function currentPosition(): Promise<GeoPoint> {
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new PositionUnavailableError("services_off");
  }
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new PositionUnavailableError(permission.canAskAgain ? "denied" : "blocked");
  }
  const reading = await positionWithFallback(
    async () =>
      toReading(
        await withTimeout(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
          POSITION_TIMEOUT_MS,
        ),
      ),
    async () => {
      const last = await Location.getLastKnownPositionAsync();
      return last && toReading(last);
    },
    Date.now,
  );
  return {
    latitude: reading.latitude,
    longitude: reading.longitude,
    ...(reading.accuracy !== null && { accuracyMeters: reading.accuracy }),
  };
}

function toReading({ coords, timestamp }: Location.LocationObject): PositionReading {
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy,
    timestamp,
  };
}
