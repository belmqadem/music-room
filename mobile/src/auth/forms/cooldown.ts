// The backend refuses a new code within 60 s of the last one (silently, so it reveals nothing).
// The app mirrors that wait so the "send a new code" button does not look broken.
export const RESEND_COOLDOWN_SECONDS = 60;

export function secondsUntilResend(sentAt: number | null, now: number): number {
  if (sentAt === null) return 0;
  const left = Math.ceil((sentAt + RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000);
  // Clamped: a clock moved backwards must not make the wait longer than the backend's.
  return Math.min(RESEND_COOLDOWN_SECONDS, Math.max(0, left));
}
