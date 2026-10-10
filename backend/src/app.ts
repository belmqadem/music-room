import express, { type Express } from "express";
import type { Redis } from "ioredis";
import type pg from "pg";
import type { Logger } from "pino";
import swaggerUi from "swagger-ui-express";
import { openApiDocument } from "./config/swagger.js";
import { createErrorHandler, notFoundHandler } from "./middleware/error-handler.js";
import type { RateLimitSettings } from "./middleware/rate-limit.js";
import { createAuthRoutes } from "./modules/auth/routes.js";
import { createAuthService } from "./modules/auth/service.js";

export interface AppDependencies {
  pool: pg.Pool;
  jwtSecret: string;
  logger: Logger;
  /** Rate-limit counters live here; without it they are kept in memory (tests). */
  redis?: Redis;
  /** Tests only: cheaper bcrypt and custom rate limits. */
  passwordCost?: number;
  loginLimit?: RateLimitSettings;
  registerLimit?: RateLimitSettings;
  refreshLimit?: RateLimitSettings;
}

// Builds the Express app WITHOUT listening, so tests can drive it in-process
// (supertest) with their own dependencies. server.ts is the only file that
// reads the environment, opens connections and listens.
export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by"); // do not advertise the framework
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

  const authService = createAuthService({
    pool: deps.pool,
    jwtSecret: deps.jwtSecret,
    logger: deps.logger,
    ...(deps.passwordCost !== undefined && { passwordCost: deps.passwordCost }),
  });
  app.use(
    "/api/v1",
    createAuthRoutes({
      service: authService,
      jwtSecret: deps.jwtSecret,
      ...(deps.redis && { redis: deps.redis }),
      ...(deps.loginLimit && { loginLimit: deps.loginLimit }),
      ...(deps.registerLimit && { registerLimit: deps.registerLimit }),
      ...(deps.refreshLimit && { refreshLimit: deps.refreshLimit }),
    }),
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler(deps.logger));
  return app;
}
