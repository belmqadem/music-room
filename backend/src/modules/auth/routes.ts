import type { Router as ExpressRouter } from "express";
import { Router } from "express";
import type { Redis } from "ioredis";
import { createAuthenticate } from "../../middleware/authenticate.js";
import {
  createRateLimiter,
  DEFAULT_LOGIN_LIMIT,
  DEFAULT_REGISTER_LIMIT,
  type RateLimitSettings,
} from "../../middleware/rate-limit.js";
import { createAuthController } from "./controller.js";
import type { AuthService } from "./service.js";

export interface AuthRoutesOptions {
  service: AuthService;
  jwtSecret: string;
  redis?: Redis;
  loginLimit?: RateLimitSettings;
  registerLimit?: RateLimitSettings;
}

/** Mounted at /api/v1: POST /auth/register, POST /auth/login, GET /users/me. */
export function createAuthRoutes(options: AuthRoutesOptions): ExpressRouter {
  const controller = createAuthController(options.service);
  const authenticate = createAuthenticate(options.jwtSecret);
  const loginLimiter = createRateLimiter(
    "login",
    options.loginLimit ?? DEFAULT_LOGIN_LIMIT,
    options.redis,
  );
  const registerLimiter = createRateLimiter(
    "register",
    options.registerLimit ?? DEFAULT_REGISTER_LIMIT,
    options.redis,
  );

  const router = Router();
  router.post("/auth/register", registerLimiter, controller.register);
  router.post("/auth/login", loginLimiter, controller.login);
  router.get("/users/me", authenticate, controller.me);
  return router;
}
