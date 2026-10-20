import type { Invitation } from "@music-room/shared";

// The invited list as the owner sees it: newest first (the server's order), one entry per person.

/** A new invitation goes first; inviting someone already listed does not list them twice. */
export function withInvitation(list: Invitation[], invitation: Invitation): Invitation[] {
  return [invitation, ...list.filter((i) => i.user.id !== invitation.user.id)];
}

export function withoutInvitee(list: Invitation[], userId: string): Invitation[] {
  return list.filter((i) => i.user.id !== userId);
}

/** Appends a next page, skipping anyone already shown (the list can change between pages). */
export function withNextPage(list: Invitation[], page: Invitation[]): Invitation[] {
  const shown = new Set(list.map((i) => i.user.id));
  return [...list, ...page.filter((i) => !shown.has(i.user.id))];
}

export function invitedIds(list: Invitation[]): ReadonlySet<string> {
  return new Set(list.map((i) => i.user.id));
}
