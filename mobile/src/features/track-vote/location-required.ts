import type { GeoPoint } from "@music-room/shared";
import { isRequestError } from "@/api/api-error";

/**
 * A vote or suggestion in an event that may take votes only at its place (ADR-034). The position is
 * asked for only when the server says it needs it (400 LOCATION_REQUIRED): first without, then once
 * more with it. `alreadyRequired` skips the first try once this event is known to need it. The
 * server checks the time first, so outside the event's hours nobody is asked for a position.
 */
export async function sendWithLocationIfRequired<T>(
  send: (location?: GeoPoint) => Promise<T>,
  getPosition: () => Promise<GeoPoint>,
  alreadyRequired: boolean,
): Promise<{ result: T; locationRequired: boolean }> {
  if (!alreadyRequired) {
    try {
      return { result: await send(), locationRequired: false };
    } catch (error) {
      if (!(isRequestError(error) && error.code === "LOCATION_REQUIRED")) throw error;
    }
  }
  const location = await getPosition();
  return { result: await send(location), locationRequired: true };
}
