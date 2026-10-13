import type { Page, Track } from "@music-room/shared";
import type { Logger } from "pino";
import { HttpError } from "../../http-error.js";
import { CatalogUnavailableError, type CatalogProvider } from "./catalog.js";

export interface CatalogService {
  search(query: string, limit: number): Promise<Page<Track>>;
}

export function createCatalogService(deps: {
  catalog: CatalogProvider;
  logger: Logger;
}): CatalogService {
  return {
    async search(query, limit) {
      try {
        const items = await deps.catalog.search(query, limit);
        // The catalog gives one page of best matches; there is no "next page".
        return { items, nextCursor: null };
      } catch (error) {
        if (error instanceof CatalogUnavailableError) {
          // The query is the user's own text, so it is not logged.
          deps.logger.error({ reason: error.message }, "music catalog unavailable");
          throw new HttpError(
            502,
            "PROVIDER_UNAVAILABLE",
            "The music catalog could not be reached. Try again later.",
          );
        }
        throw error;
      }
    },
  };
}
