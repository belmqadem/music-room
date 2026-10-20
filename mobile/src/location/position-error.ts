// Why the phone could not give a position, kept apart from expo-location so it is tested in Node.

export type PositionProblem =
  /** Location services are switched off on the phone. */
  | "services_off"
  /** The user said no; the app may ask again. */
  | "denied"
  /** The user said no for good: only the Settings app can change it. */
  | "blocked"
  /** No position came within the time limit. */
  | "timeout";

export class PositionUnavailableError extends Error {
  constructor(readonly problem: PositionProblem) {
    super(`No position: ${problem}`);
    this.name = "PositionUnavailableError";
  }
}

export function isPositionUnavailable(error: unknown): error is PositionUnavailableError {
  return error instanceof PositionUnavailableError;
}

/** expo-location has no timeout: give up after `ms` instead of leaving the vote button spinning. */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PositionUnavailableError("timeout")), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
