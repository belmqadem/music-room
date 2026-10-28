import type { Page, Track, TrackPreview } from "@music-room/shared";
import type { Logger } from "pino";
import { HttpError } from "../../http-error.js";
import { CatalogUnavailableError, type CatalogProvider } from "./catalog.js";

export interface CatalogService {
  search(query: string, limit: number): Promise<Page<Track>>;
  /** A fresh link to the track's 30-second sample (ADR-053). */
  preview(providerTrackId: string): Promise<TrackPreview>;
}

export function createCatalogService(deps: {
  catalog: CatalogProvider;
  logger: Logger;
}): CatalogService {
  /** A catalog outage becomes 502 PROVIDER_UNAVAILABLE; anything else is a bug and stays one. */
  async function askCatalog<T>(ask: () => Promise<T>): Promise<T> {
    try {
      return await ask();
    } catch (error) {
      if (error instanceof CatalogUnavailableError) {
        // Only the reason: a search's text is the user's own and is never logged.
        deps.logger.error({ reason: error.message }, "music catalog unavailable");
        throw new HttpError(
          502,
          "PROVIDER_UNAVAILABLE",
          "The music catalog could not be reached. Try again later.",
        );
      }
      throw error;
    }
  }

  return {
    async search(query, limit) {
      const items = await askCatalog(() => deps.catalog.search(query, limit));
      // The catalog gives one page of best matches; there is no "next page".
      return { items, nextCursor: null };
    },

    async preview(providerTrackId) {
      const found = await askCatalog(() => deps.catalog.getPreview(providerTrackId));
      if (found.kind === "unknownTrack")
        throw new HttpError(404, "TRACK_NOT_FOUND", "Track not found.");
      if (found.kind === "noPreview")
        throw new HttpError(404, "PREVIEW_UNAVAILABLE", "This track has no preview.");
      return { url: found.url };
    },
  };
}
