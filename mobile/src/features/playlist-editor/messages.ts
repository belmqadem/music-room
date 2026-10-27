import type { EditLicense, Playlist } from "@music-room/shared";
import { isRequestError } from "@/api/api-error";
import { MESSAGES } from "@/auth/forms/error-messages";
import { copy } from "@/copy";

// What to tell the user when a Playlist Editor call fails, from the stable code (docs/api-contract.md,
// "Playlists"), and how a playlist's modes read.

export const PLAYLIST_MESSAGES = {
  ...copy.playlistEditor.errors,
  catalogMissing: copy.errors.catalogMissing,
  catalogDown: copy.errors.catalogDown,
  unknown: copy.errors.unknown,
};

export function playlistErrorMessage(error: unknown): string {
  if (!isRequestError(error)) return PLAYLIST_MESSAGES.unknown;
  switch (error.code) {
    case "NETWORK_ERROR":
      return MESSAGES.network;
    case "RATE_LIMITED":
      return MESSAGES.rateLimited;
    // ADR-048: the server refuses a Premium feature to a Free user.
    case "PREMIUM_REQUIRED":
      return copy.plan.required;
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
  return copy.playlists.editRule[license.type];
}

export function playlistTags(playlist: Playlist): string[] {
  const tags: string[] = [];
  if (playlist.myPermissions.canManage) tags.push(copy.common.yours);
  if (playlist.visibility === "private") tags.push(copy.common.private);
  return tags;
}
