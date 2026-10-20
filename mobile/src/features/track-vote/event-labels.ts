import type { MusicEvent, VoteLicense } from "@music-room/shared";

// How an event's modes read in the app. Plain functions, so the wording is tested once.

export function voteLicenseLabel(license: VoteLicense): string {
  switch (license.type) {
    case "everyone":
      return "Everyone can vote";
    case "invited_only":
      return "Invited people vote";
    case "location_time":
      return "Votes at the venue, during the event";
  }
}

/** Short tags for a list row: whose it is, and whether it is private. */
export function eventTags(event: MusicEvent): string[] {
  const tags: string[] = [];
  if (event.myPermissions.canManage) tags.push("Yours");
  if (event.visibility === "private") tags.push("Private");
  return tags;
}
