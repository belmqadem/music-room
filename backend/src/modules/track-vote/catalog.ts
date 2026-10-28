import type { Track } from "@music-room/shared";

// The music catalog the backend resolves tracks from (ADR-015). Everything a
// catalog returns is third-party text and URLs: it is cleaned before it becomes a Track.
export interface CatalogProvider {
  /** Tracks matching a text search, best match first. */
  search(query: string, limit: number): Promise<Track[]>;
  /** One track by the catalog's own id, or null if the catalog does not know it. */
  getTrack(providerTrackId: string): Promise<Track | null>;
  /** A fresh link to the track's 30-second sample (ADR-053). */
  getPreview(providerTrackId: string): Promise<PreviewLookup>;
}

/** What the catalog knows about a track's sample: a link, no sample, or no such track. */
export type PreviewLookup =
  { kind: "found"; url: string } | { kind: "noPreview" } | { kind: "unknownTrack" };

/** We could not get a usable answer (network, timeout, quota, a malformed answer, not configured). */
export class CatalogUnavailableError extends Error {
  constructor(reason: string) {
    super(`Catalog unavailable: ${reason}`);
    this.name = "CatalogUnavailableError";
  }
}

/** Stands in when no catalog is configured (tests that do not need one). */
export const unconfiguredCatalog: CatalogProvider = {
  search: () => Promise.reject(new CatalogUnavailableError("not configured")),
  getTrack: () => Promise.reject(new CatalogUnavailableError("not configured")),
  getPreview: () => Promise.reject(new CatalogUnavailableError("not configured")),
};
