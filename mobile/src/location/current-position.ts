import type { GeoPoint } from "@music-room/shared";
import * as Location from "expo-location";
import { PositionUnavailableError, withTimeout } from "./position-error";

export const POSITION_TIMEOUT_MS = 15_000;

/**
 * The phone's position, for a vote in a "place and time" event (docs/api-contract.md, Access
 * rules). Asked only when the server needs it; the permission is "while using the app". The
 * accuracy goes with it: the server refuses a position worse than 100 m. Nothing is stored.
 */
export async function currentPosition(): Promise<GeoPoint> {
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new PositionUnavailableError("services_off");
  }
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new PositionUnavailableError(permission.canAskAgain ? "denied" : "blocked");
  }
  const { coords } = await withTimeout(
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
    POSITION_TIMEOUT_MS,
  );
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    ...(coords.accuracy !== null && { accuracyMeters: coords.accuracy }),
  };
}
