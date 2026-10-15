import type { Router as ExpressRouter } from "express";
import { Router } from "express";
import { createAuthenticate } from "../../middleware/authenticate.js";
import { createProfileController } from "./controller.js";
import type { ProfileService } from "./service.js";

/**
 * Mounted at /api/v1. EVERY route is authenticated here. Authorization is the visibility rule in
 * visibility.ts: editing is only ever of the caller's OWN profile (there is no user id in the
 * PATCH path), and reading someone else's shows only the blocks the caller may see.
 */
export function createProfileRoutes(options: {
  service: ProfileService;
  jwtSecret: string;
}): ExpressRouter {
  const controller = createProfileController(options.service);
  const router = Router();
  router.use("/users", createAuthenticate(options.jwtSecret));
  router.get("/users/me/profile", controller.getOwn);
  router.patch("/users/me/profile", controller.update);
  router.get("/users/:userId/profile", controller.getOf);
  return router;
}
