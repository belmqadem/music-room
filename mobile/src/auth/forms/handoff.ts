// What one auth screen tells the next: the email being worked on, when a code was last sent, and a
// one-time notice ("Email confirmed. Sign in."). Kept in memory on purpose and NOT put in the route:
// an email in a URL ends up in browser history and server logs. It is a UI convenience, not state
// the app depends on: every screen still works (and asks) when it is empty.

export interface AuthHandoff {
  email: string | null;
  codeSentAt: number | null;
  notice: string | null;
}

let current: AuthHandoff = { email: null, codeSentAt: null, notice: null };

export function handOff(next: Partial<AuthHandoff>): void {
  current = { ...current, ...next };
}

export const readHandoff = (): AuthHandoff => current;

/** The notice is shown once, then forgotten. */
export function takeNotice(): string | null {
  const notice = current.notice;
  current = { ...current, notice: null };
  return notice;
}

/** After a successful sign-in nothing from the sign-up or reset flow should linger. */
export function clearHandoff(): void {
  current = { email: null, codeSentAt: null, notice: null };
}
