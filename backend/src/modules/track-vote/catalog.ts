import type { Track } from "@music-room/shared";

// The music catalog the backend resolves tracks from (ADR-015). Everything a
// catalog returns is third-party text and URLs: it is cleaned before it becomes a Track.
export interface CatalogProvider {
  /** Tracks matching a text search, best match first. */
  search(query: string, limit: number): Promise<Track[]>;
  /** One track by the catalog's own id, or null if the catalog does not know it. */
  getTrack(providerTrackId: string): Promise<Track | null>;
}

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
};
