import { PositionUnavailableError } from "./position-error";

// When no fresh fix comes in time (indoors, a GPS that has not warmed up), the last position the
// phone already knows can do, if it is recent and precise enough for the server. Kept apart from
// expo-location so it is tested in Node.

/** A last known position older than this is not used: the person may have left the venue since. */
export const LAST_KNOWN_MAX_AGE_MS = 2 * 60_000;
/** The server refuses a less precise position (backend access/rules.ts, MAX_ACCURACY_METERS). */
export const MAX_ACCURACY_METERS = 100;

export interface PositionReading {
  latitude: number;
  longitude: number;
  /** Radius of uncertainty in meters; null when the phone does not say. */
  accuracy: number | null;
  /** When the phone measured it, in ms since the epoch. */
  timestamp: number;
}

/** The last known position if it is recent and precise enough to send, else null. */
export function usableLastKnown(
  reading: PositionReading | null,
  now: number,
): PositionReading | null {
  if (!reading) return null;
  const recent = now - reading.timestamp <= LAST_KNOWN_MAX_AGE_MS;
  const precise = reading.accuracy !== null && reading.accuracy <= MAX_ACCURACY_METERS;
  return recent && precise ? reading : null;
}

/**
 * A fresh position; if none comes (time limit or a failure of the phone), the last known one when
 * it is usable. Otherwise the reason is raised. Permission problems never reach this: they are
 * checked before, and a refused permission must not fall back to a stored position.
 */
export async function positionWithFallback(
  fresh: () => Promise<PositionReading>,
  lastKnown: () => Promise<PositionReading | null>,
  now: () => number,
): Promise<PositionReading> {
  try {
    return await fresh();
  } catch (freshError) {
    const known = await lastKnown().catch((error: unknown) => {
      console.warn("Could not read the last known position:", error);
      return null;
    });
    const usable = usableLastKnown(known, now());
    if (usable) return usable;
    if (freshError instanceof PositionUnavailableError) throw freshError;
    console.warn("The phone could not give a position:", freshError);
    throw new PositionUnavailableError("timeout");
  }
}
