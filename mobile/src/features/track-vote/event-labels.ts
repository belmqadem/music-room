import type { LocationTimeRule, MusicEvent, VoteLicense } from "@music-room/shared";

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

const shortDateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Where and when a "place and time" event takes votes, in the phone's language and time zone. The
 * server compares with its own clock and the exact distance; this is only for the user to read.
 */
export function locationRuleText(
  rule: LocationTimeRule,
  formatDate: (iso: string) => string = (iso) => shortDateTime.format(new Date(iso)),
): string {
  return `Within ${rule.radiusMeters} m of the venue, from ${formatDate(rule.startsAt)} to ${formatDate(rule.endsAt)}.`;
}
