import type { Router as ExpressRouter } from "express";
import { Router } from "express";
import type { Redis } from "ioredis";
import { createAuthenticate } from "../../middleware/authenticate.js";
import {
  createRateLimiter,
  DEFAULT_PLAYLIST_ADD_LIMIT,
  type RateLimitSettings,
} from "../../middleware/rate-limit.js";
import { createEntryController } from "./entry-controller.js";
import type { EntryService } from "./entry-service.js";
import { createPlaylistController } from "./controller.js";
import type { PlaylistService } from "./service.js";

/**
 * Mounted at /api/v1. EVERY route is authenticated here; authorization (may THIS user
 * see/change THIS playlist?) is done in the service through the access engine.
 */
export function createPlaylistRoutes(options: {
  service: PlaylistService;
  entries: EntryService;
  jwtSecret: string;
  redis?: Redis;
  addLimit?: RateLimitSettings;
}): ExpressRouter {
  const controller = createPlaylistController(options.service);
  const entries = createEntryController(options.entries);
  const router = Router();
  router.use("/playlists", createAuthenticate(options.jwtSecret));
  router.post("/playlists", controller.create);
  router.get("/playlists", controller.list);
  router.get("/playlists/:playlistId", controller.get);
  router.patch("/playlists/:playlistId", controller.update);
  router.delete("/playlists/:playlistId", controller.remove);
  router.get("/playlists/:playlistId/invitations", controller.listInvitations);
  router.post("/playlists/:playlistId/invitations", controller.invite);
  router.delete(
    "/playlists/:playlistId/invitations/:userId",
    controller.removeInvitation,
  );

  router.get("/playlists/:playlistId/tracks", entries.getSnapshot);
  // Each addition is one request to the music catalog, which has its own quota.
  router.post(
    "/playlists/:playlistId/tracks",
    createRateLimiter(
      "playlist-add",
      options.addLimit ?? DEFAULT_PLAYLIST_ADD_LIMIT,
      options.redis,
    ),
    entries.add,
  );
  router.post("/playlists/:playlistId/tracks/:entryId/move", entries.move);
  router.delete("/playlists/:playlistId/tracks/:entryId", entries.remove);
  return router;
}
