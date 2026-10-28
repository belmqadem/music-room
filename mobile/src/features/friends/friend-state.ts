import type { Profile } from "@music-room/shared";

// Where you stand with someone, from their profile's `friendship` (ADR-042): it decides which
// action their profile offers. The server's answer is the truth; after any action the profile is
// read again rather than updated here.

export type FriendState =
  | { kind: "self" }
  | { kind: "none" }
  | { kind: "sent"; requestId: string }
  | { kind: "received"; requestId: string }
  | { kind: "friends" };

export function friendStateOf(profile: Profile, myId: string): FriendState {
  // Your own profile has no friendship; checked first so it never offers "Add friend".
  if (profile.userId === myId) return { kind: "self" };
  const friendship = profile.friendship;
  if (!friendship) return { kind: "none" };
  if (friendship.status === "accepted") return { kind: "friends" };
  return friendship.direction === "outgoing"
    ? { kind: "sent", requestId: friendship.id }
    : { kind: "received", requestId: friendship.id };
}

/** The number on the Friends row: nothing for none, "20+" when there is another page. */
export function requestCountLabel(shown: number, more: boolean): string | null {
  if (shown === 0) return null;
  return more ? `${shown}+` : String(shown);
}
