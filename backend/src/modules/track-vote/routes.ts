import type { Router as ExpressRouter } from "express";
import { Router } from "express";
import { createAuthenticate } from "../../middleware/authenticate.js";
import { createEventController } from "./controller.js";
import type { EventService } from "./service.js";

/**
 * Mounted at /api/v1. EVERY route is authenticated here; authorization (may THIS
 * user see/change THIS event?) is done in the service through the access engine.
 */
export function createEventRoutes(options: {
  service: EventService;
  jwtSecret: string;
}): ExpressRouter {
  const controller = createEventController(options.service);
  const router = Router();
  router.use("/events", createAuthenticate(options.jwtSecret));
  router.post("/events", controller.create);
  router.get("/events", controller.list);
  router.get("/events/:eventId", controller.get);
  router.patch("/events/:eventId", controller.update);
  router.delete("/events/:eventId", controller.remove);
  router.get("/events/:eventId/invitations", controller.listInvitations);
  router.post("/events/:eventId/invitations", controller.invite);
  router.delete("/events/:eventId/invitations/:userId", controller.removeInvitation);
  return router;
}
