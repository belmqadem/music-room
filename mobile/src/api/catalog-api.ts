import type { Page, Track, TrackPreview } from "@music-room/shared";
import { auth } from "@/auth";

// The music catalog (Deezer, through the backend: docs/api-contract.md, "Music catalog", ADR-015).
// Shared by Track Vote (suggest) and the Playlist Editor (add). One page, at most 25 results.

export const SEARCH_LIMIT = 20;

export const catalogApi = {
  search: (query: string) =>
    auth.request<Page<Track>>("GET", "/tracks/search", {
      query: { query, limit: SEARCH_LIMIT },
    }),
  /** A fresh link to the track's 30-second sample (ADR-053). Never stored: it expires. */
  preview: (providerTrackId: string) =>
    auth.request<TrackPreview>(
      "GET",
      `/tracks/${encodeURIComponent(providerTrackId)}/preview`,
    ),
};
