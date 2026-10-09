// API contract: Playlist Editor. Owner: belmqadem. Changes need review from BOTH developers.
// See docs/api-contract.md ("Playlists", "Concurrency") and ADR-009.
import type { EditLicense, MyPermissions } from "./license";
import type { Track } from "./track";
import type { Visibility } from "./visibility";

export interface Playlist {
  id: string; // UUID
  name: string;
  ownerId: string; // User id
  visibility: Visibility;
  editLicense: EditLicense;
  createdAt: string; // ISO 8601 UTC
  myPermissions: MyPermissions;
}

/** One occurrence of a track in a playlist. The same song can appear twice. */
export interface PlaylistEntry {
  id: string; // UUID of this entry (not of the track)
  track: Track;
  addedBy: string; // User id
  addedAt: string; // ISO 8601 UTC
}

/**
 * The ordered tracks plus the playlist's version. Returned by every edit and
 * pushed on Socket.io `playlist:updated`. Ignore a snapshot whose version is
 * not newer than yours; refetch if you see a gap.
 */
export interface PlaylistSnapshot {
  playlistId: string;
  version: number;
  tracks: PlaylistEntry[];
}

export interface CreatePlaylistRequest {
  name: string;
  visibility?: Visibility; // default "public"
  editLicense?: EditLicense; // default { type: "everyone" }
}

/** All fields optional; at least one must be present. */
export interface UpdatePlaylistRequest {
  name?: string;
  visibility?: Visibility;
  editLicense?: EditLicense;
}

export interface AddPlaylistTrackRequest {
  providerTrackId: string;
  /** Insert after this entry; omit to append at the end. */
  afterEntryId?: string;
}

export interface MovePlaylistTrackRequest {
  /** Move after this entry; null moves to the start. */
  afterEntryId: string | null;
}
