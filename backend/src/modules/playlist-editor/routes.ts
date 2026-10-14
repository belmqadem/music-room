import type { Router as ExpressRouter } from "express";
import { Router } from "express";
import { createAuthenticate } from "../../middleware/authenticate.js";
import { createPlaylistController } from "./controller.js";
import type { PlaylistService } from "./service.js";

/**
 * Mounted at /api/v1. EVERY route is authenticated here; authorization (may THIS user
 * see/change THIS playlist?) is done in the service through the access engine.
 */
export function createPlaylistRoutes(options: {
  service: PlaylistService;
  jwtSecret: string;
}): ExpressRouter {
  const controller = createPlaylistController(options.service);
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
  return router;
}
