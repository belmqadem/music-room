import type { Request, Response, Router as ExpressRouter } from "express";
import { Router } from "express";
import type { Redis } from "ioredis";
import { z } from "zod";
import { HttpError } from "../../http-error.js";
import { createAuthenticate } from "../../middleware/authenticate.js";
import {
  createRateLimiter,
  DEFAULT_CATALOG_SEARCH_LIMIT,
  DEFAULT_TRACK_PREVIEW_LIMIT,
  type RateLimitSettings,
} from "../../middleware/rate-limit.js";
import type { CatalogService } from "./catalog-service.js";

const searchQuerySchema = z.object({
  query: z.string().trim().min(2).max(100),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

// The same shape as a suggested track's id; the catalog adapter checks it again.
const previewParamsSchema = z.object({
  providerTrackId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
});

/**
 * Mounted at /api/v1: GET /tracks/search?query=&limit= (the suggest screen's lookup) and
 * GET /tracks/{providerTrackId}/preview (a 30-second sample, ADR-053).
 */
export function createCatalogRoutes(options: {
  service: CatalogService;
  jwtSecret: string;
  redis?: Redis;
  searchLimit?: RateLimitSettings;
  previewLimit?: RateLimitSettings;
}): ExpressRouter {
  const router = Router();
  // Authenticated first, then rate limited: each search is a request to a third party
  // with a quota of its own, so an unauthenticated flood must not reach it.
  router.get(
    "/tracks/search",
    createAuthenticate(options.jwtSecret),
    createRateLimiter(
      "catalog-search",
      options.searchLimit ?? DEFAULT_CATALOG_SEARCH_LIMIT,
      options.redis,
    ),
    async (req: Request, res: Response): Promise<void> => {
      if (!req.auth)
        throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
      const { query, limit } = searchQuerySchema.parse(req.query);
      res
        .set("Cache-Control", "no-store")
        .status(200)
        .json(await options.service.search(query, limit));
    },
  );
  // Any signed-in person may hear any catalog track's sample: it is public catalog data, like
  // search, and tied to no room or playlist. Rate limited for the same reason as search.
  router.get(
    "/tracks/:providerTrackId/preview",
    createAuthenticate(options.jwtSecret),
    createRateLimiter(
      "track-preview",
      options.previewLimit ?? DEFAULT_TRACK_PREVIEW_LIMIT,
      options.redis,
    ),
    async (req: Request, res: Response): Promise<void> => {
      if (!req.auth)
        throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
      const { providerTrackId } = previewParamsSchema.parse(req.params);
      res
        // The link is signed and expires: never cached, by us or anything in between.
        .set("Cache-Control", "no-store")
        .status(200)
        .json(await options.service.preview(providerTrackId));
    },
  );
  return router;
}
