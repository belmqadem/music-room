import type { Router as ExpressRouter } from "express";
import { Router } from "express";
import type { Redis } from "ioredis";
import { createAuthenticate } from "../../middleware/authenticate.js";
import {
  createRateLimiter,
  DEFAULT_FRIEND_REQUEST_LIMIT,
  type RateLimitSettings,
} from "../../middleware/rate-limit.js";
import { createFriendController } from "./controller.js";
import type { FriendService } from "./service.js";

/**
 * Mounted at /api/v1. EVERY route is authenticated here. Authorization is in the SQL and the
 * service: a user can only ever act on friendships they are part of, and only the addressee
 * can accept.
 */
export function createFriendRoutes(options: {
  service: FriendService;
  jwtSecret: string;
  redis?: Redis;
  requestLimit?: RateLimitSettings;
}): ExpressRouter {
  const controller = createFriendController(options.service);
  const router = Router();
  router.use("/friends", createAuthenticate(options.jwtSecret));
  router.get("/friends", controller.listFriends);
  router.delete("/friends/:userId", controller.unfriend);
  router.post(
    "/friends/requests",
    createRateLimiter(
      "friend-request",
      options.requestLimit ?? DEFAULT_FRIEND_REQUEST_LIMIT,
      options.redis,
    ),
    controller.sendRequest,
  );
  router.get("/friends/requests", controller.listRequests);
  router.post("/friends/requests/:requestId/accept", controller.accept);
  router.delete("/friends/requests/:requestId", controller.removeRequest);
  return router;
}
