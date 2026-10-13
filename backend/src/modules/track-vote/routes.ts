import type { Router as ExpressRouter } from "express";
import { Router } from "express";
import { createAuthenticate } from "../../middleware/authenticate.js";
import type { Redis } from "ioredis";
import {
  createRateLimiter,
  DEFAULT_SUGGEST_LIMIT,
  type RateLimitSettings,
} from "../../middleware/rate-limit.js";
import { createEventController } from "./controller.js";
import { createQueueController } from "./queue-controller.js";
import type { QueueService } from "./queue-service.js";
import type { EventService } from "./service.js";

/**
 * Mounted at /api/v1. EVERY route is authenticated here; authorization (may THIS
 * user see/change THIS event?) is done in the service through the access engine.
 */
export function createEventRoutes(options: {
  service: EventService;
  queue: QueueService;
  jwtSecret: string;
  redis?: Redis;
  suggestLimit?: RateLimitSettings;
}): ExpressRouter {
  const controller = createEventController(options.service);
  const queue = createQueueController(options.queue);
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

  router.get("/events/:eventId/tracks", queue.getQueue);
  // Each suggestion is one request to the music catalog, which has its own quota.
  router.post(
    "/events/:eventId/tracks",
    createRateLimiter(
      "suggest",
      options.suggestLimit ?? DEFAULT_SUGGEST_LIMIT,
      options.redis,
    ),
    queue.suggest,
  );
  router.put("/events/:eventId/tracks/:trackId/vote", queue.vote);
  router.delete("/events/:eventId/tracks/:trackId/vote", queue.withdrawVote);
  return router;
}
