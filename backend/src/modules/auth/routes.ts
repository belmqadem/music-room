import type { Router as ExpressRouter } from "express";
import { Router } from "express";
import type { Redis } from "ioredis";
import { createAuthenticate } from "../../middleware/authenticate.js";
import {
  createRateLimiter,
  DEFAULT_LOGIN_LIMIT,
  DEFAULT_REFRESH_LIMIT,
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
  refreshLimit?: RateLimitSettings;
}

/** Mounted at /api/v1: /auth/{register,login,refresh,logout,oauth/:provider}, /users/me and /users/me/providers/:provider. */
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

  const refreshLimiter = createRateLimiter(
    "refresh",
    options.refreshLimit ?? DEFAULT_REFRESH_LIMIT,
    options.redis,
  );

  const router = Router();
  router.post("/auth/register", registerLimiter, controller.register);
  router.post("/auth/login", loginLimiter, controller.login);
  // Public on purpose: the access token has usually expired when the app refreshes.
  router.post("/auth/refresh", refreshLimiter, controller.refresh);
  router.post("/auth/logout", authenticate, controller.logout);
  router.get("/users/me", authenticate, controller.me);
  // Social login shares the login limit: it is another way to try to get in.
  router.post("/auth/oauth/:provider", loginLimiter, controller.oauthLogin);
  router.post(
    "/users/me/providers/:provider",
    authenticate,
    loginLimiter,
    controller.linkProvider,
  );
  router.delete("/users/me/providers/:provider", authenticate, controller.unlinkProvider);
  return router;
}
