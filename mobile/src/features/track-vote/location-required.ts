import type { GeoPoint } from "@music-room/shared";
import { isRequestError } from "@/api/api-error";

export interface LocationMemory {
  /** This event already asked for a position: send it straight away. */
  alreadyRequired: boolean;
  /** Called as soon as the server asks for a position, even if the vote with it then fails. */
  onRequired(): void;
}

/**
 * A vote or suggestion in an event that may take votes only at its place (ADR-034). The position is
 * asked for only when the server says it needs it (400 LOCATION_REQUIRED): first without, then once
 * more with it. Once an event asked, the next votes send the position straight away. The server
 * checks the time first, so outside the event's hours nobody is asked for a position.
 */
export async function sendWithLocationIfRequired<T>(
  send: (location?: GeoPoint) => Promise<T>,
  getPosition: () => Promise<GeoPoint>,
  memory: LocationMemory,
): Promise<T> {
  if (!memory.alreadyRequired) {
    try {
      return await send();
    } catch (error) {
      if (!(isRequestError(error) && error.code === "LOCATION_REQUIRED")) throw error;
      // Remembered now: a refusal of the vote with the position (too far) must not forget it.
      memory.onRequired();
    }
  }
  return send(await getPosition());
}
