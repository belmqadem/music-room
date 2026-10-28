import { useEffect, useState } from "react";
import { secondsUntilResend } from "./cooldown";

/** Seconds until a new code may be asked for; re-renders every second while counting down. */
export function useSecondsUntilResend(sentAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  // `now` may be a little old when a new code was just sent; the count is clamped to 60 s, and the
  // first tick (within a second) brings it up to date.
  const left = secondsUntilResend(sentAt, now);
  const counting = left > 0;

  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  return left;
}
