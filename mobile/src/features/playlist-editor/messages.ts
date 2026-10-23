import type { EditLicense, Playlist } from "@music-room/shared";
import { isRequestError } from "@/api/api-error";
import { MESSAGES } from "@/auth/forms/error-messages";

// What to tell the user when a Playlist Editor call fails, from the stable code (docs/api-contract.md,
// "Playlists"), and how a playlist's modes read.

export const PLAYLIST_MESSAGES = {
  notFound: "This playlist no longer exists, or you can no longer see it.",
  notInvited: "Only invited people can edit this playlist.",
  // Someone else moved or removed the track it was placed after: the list is read again.
  anchorGone: "The playlist changed meanwhile. Here it is again; try once more.",
  entryGone: "That track was just removed by someone else.",
  full: "This playlist is full (500 tracks).",
  catalogMissing: "The catalog no longer has this track.",
  catalogDown: "The music catalog can't be reached right now. Try again in a moment.",
  ownerOnly: "Only the playlist's owner can do that.",
  unknown: "Something went wrong. Try again.",
} as const;

export function playlistErrorMessage(error: unknown): string {
  if (!isRequestError(error)) return PLAYLIST_MESSAGES.unknown;
  switch (error.code) {
    case "NETWORK_ERROR":
      return MESSAGES.network;
    case "RATE_LIMITED":
      return MESSAGES.rateLimited;
    case "PLAYLIST_NOT_FOUND":
    case "NOT_FOUND":
      return PLAYLIST_MESSAGES.notFound;
    case "NOT_INVITED":
      return PLAYLIST_MESSAGES.notInvited;
    case "ANCHOR_NOT_FOUND":
      return PLAYLIST_MESSAGES.anchorGone;
    // On a move or remove, TRACK_NOT_FOUND is the entry (gone); on an add, the catalog's track.
    case "TRACK_NOT_FOUND":
      return PLAYLIST_MESSAGES.entryGone;
    case "PLAYLIST_FULL":
      return PLAYLIST_MESSAGES.full;
    case "PROVIDER_UNAVAILABLE":
      return PLAYLIST_MESSAGES.catalogDown;
    case "FORBIDDEN":
      return PLAYLIST_MESSAGES.ownerOnly;
    default:
      return error.status >= 500 ? MESSAGES.server : PLAYLIST_MESSAGES.unknown;
  }
}

/** On an add, a TRACK_NOT_FOUND means the catalog does not know the track. */
export function addTrackErrorMessage(error: unknown): string {
  return isRequestError(error) && error.code === "TRACK_NOT_FOUND"
    ? PLAYLIST_MESSAGES.catalogMissing
    : playlistErrorMessage(error);
}

/** After these, the list on screen is out of date: read it again. */
export function shouldReload(error: unknown): boolean {
  return (
    isRequestError(error) &&
    (error.code === "ANCHOR_NOT_FOUND" || error.code === "TRACK_NOT_FOUND")
  );
}

export function editLicenseLabel(license: EditLicense): string {
  return license.type === "everyone" ? "Everyone can edit" : "Invited people edit";
}

export function playlistTags(playlist: Playlist): string[] {
  const tags: string[] = [];
  if (playlist.myPermissions.canManage) tags.push("Yours");
  if (playlist.visibility === "private") tags.push("Private");
  return tags;
}
