import type { Router as ExpressRouter } from "express";
import { Router } from "express";
import type { Redis } from "ioredis";
import { createAuthenticate } from "../../middleware/authenticate.js";
import {
  createRateLimiter,
  DEFAULT_USER_SEARCH_LIMIT,
  type RateLimitSettings,
} from "../../middleware/rate-limit.js";
import { createUserController } from "./controller.js";
import type { UserService } from "./service.js";

/** Mounted at /api/v1: GET /users?query= (the invite screen's user lookup). */
export function createUserRoutes(options: {
  service: UserService;
  jwtSecret: string;
  redis?: Redis;
  searchLimit?: RateLimitSettings;
}): ExpressRouter {
  const controller = createUserController(options.service);
  const router = Router();
  // Authenticated first, then rate limited: the directory is only for signed-in users,
  // and the limit makes walking it letter by letter slow.
  router.get(
    "/users",
    createAuthenticate(options.jwtSecret),
    createRateLimiter(
      "user-search",
      options.searchLimit ?? DEFAULT_USER_SEARCH_LIMIT,
      options.redis,
    ),
    controller.search,
  );
  return router;
}
