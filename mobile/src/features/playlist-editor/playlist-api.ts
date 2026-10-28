import type {
  CreatePlaylistRequest,
  Page,
  Playlist,
  PlaylistSnapshot,
} from "@music-room/shared";
import { auth } from "@/auth";

// The Playlist Editor endpoints (docs/api-contract.md, "Playlists"). Every edit answers with the
// whole new list and its version; the backend checks the access rules on every call.

const path = (playlistId: string, rest = "") =>
  `/playlists/${encodeURIComponent(playlistId)}${rest}`;
const entryPath = (playlistId: string, entryId: string, rest = "") =>
  path(playlistId, `/tracks/${encodeURIComponent(entryId)}${rest}`);

export const playlistApi = {
  /** Public playlists, mine, and private ones I am invited to, newest first. */
  list: (cursor?: string) =>
    auth.request<Page<Playlist>>("GET", "/playlists", { query: { limit: 20, cursor } }),
  /** The caller becomes the owner. */
  create: (request: CreatePlaylistRequest) =>
    auth.request<Playlist>("POST", "/playlists", { body: request }),
  get: (playlistId: string) => auth.request<Playlist>("GET", path(playlistId)),
  tracks: (playlistId: string) =>
    auth.request<PlaylistSnapshot>("GET", path(playlistId, "/tracks")),
  /** Appends (no anchor): the server resolves title and artist from the catalog. */
  add: (playlistId: string, providerTrackId: string) =>
    auth.request<PlaylistSnapshot>("POST", path(playlistId, "/tracks"), {
      body: { providerTrackId },
    }),
  /** By intent: after `afterEntryId`, or to the start with null. Never an index. */
  move: (playlistId: string, entryId: string, afterEntryId: string | null) =>
    auth.request<PlaylistSnapshot>("POST", entryPath(playlistId, entryId, "/move"), {
      body: { afterEntryId },
    }),
  /** Removing an entry already gone is not an error (the list just does not change). */
  remove: (playlistId: string, entryId: string) =>
    auth.request<PlaylistSnapshot>("DELETE", entryPath(playlistId, entryId)),
};
