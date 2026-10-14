import cors from "cors";
import express, { type Express } from "express";
import type { Redis } from "ioredis";
import type pg from "pg";
import type { Logger } from "pino";
import swaggerUi from "swagger-ui-express";
import { openApiDocument } from "./config/swagger.js";
import { createRequestLogger } from "./middleware/request-logger.js";
import { createErrorHandler, notFoundHandler } from "./middleware/error-handler.js";
import type { RateLimitSettings } from "./middleware/rate-limit.js";
import {
  unconfiguredVerifier,
  type ProviderVerifiers,
} from "./modules/auth/provider-verifier.js";
import {
  unconfiguredCatalog,
  type CatalogProvider,
} from "./modules/track-vote/catalog.js";
import { createCatalogRoutes } from "./modules/track-vote/catalog-routes.js";
import { createCatalogService } from "./modules/track-vote/catalog-service.js";
import { createQueueService } from "./modules/track-vote/queue-service.js";
import type { RealtimeEvents } from "./realtime-events.js";
import { createUserRoutes } from "./modules/users/routes.js";
import { createUserService } from "./modules/users/service.js";
import { createPlaylistRoutes } from "./modules/playlist-editor/routes.js";
import { createPlaylistService } from "./modules/playlist-editor/service.js";
import { createEventService } from "./modules/track-vote/service.js";
import { createEventRoutes } from "./modules/track-vote/routes.js";
import { createAuthRoutes } from "./modules/auth/routes.js";
import { createAuthService } from "./modules/auth/service.js";

export interface AppDependencies {
  pool: pg.Pool;
  jwtSecret: string;
  logger: Logger;
  /** Rate-limit counters live here; without it they are kept in memory (tests). */
  redis?: Redis;
  /** The music catalog. Omitted (tests): searches answer 502 PROVIDER_UNAVAILABLE. */
  catalog?: CatalogProvider;
  /** Browser origins allowed to call the API (web client). Default: none. */
  allowedOrigins?: string[];
  /** Google/Facebook checkers. Omitted (tests): both providers answer 502 PROVIDER_UNAVAILABLE. */
  providerVerifiers?: ProviderVerifiers;
  /** Tests only: cheaper bcrypt and custom rate limits. */
  passwordCost?: number;
  loginLimit?: RateLimitSettings;
  registerLimit?: RateLimitSettings;
  refreshLimit?: RateLimitSettings;
  userSearchLimit?: RateLimitSettings;
  catalogSearchLimit?: RateLimitSettings;
  suggestLimit?: RateLimitSettings;
  /** Tests only: the server clock the location_time window is judged by. */
  clock?: () => Date;
  /** Told about changes so live subscribers hear about them. Default: nobody is told. */
  realtime?: RealtimeEvents;
}

// Builds the Express app WITHOUT listening, so tests can drive it in-process
// (supertest) with their own dependencies. server.ts is the only file that
// reads the environment, opens connections and listens.
export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by"); // do not advertise the framework
  app.use(createRequestLogger(deps.logger));
  app.use(
    cors({
      // An exact-match allow-list, never "*". Requests without an Origin header
      // (the mobile app, curl) are not browsers and are unaffected.
      origin: deps.allowedOrigins ?? [],
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      // Our own headers make every browser call "non-simple", hence a preflight.
      allowedHeaders: [
        "Authorization",
        "Content-Type",
        "X-Platform",
        "X-Device",
        "X-App-Version",
      ],
      // No cookies (ADR-012): credentialed requests stay disabled.
      credentials: false,
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

  const authService = createAuthService({
    pool: deps.pool,
    jwtSecret: deps.jwtSecret,
    logger: deps.logger,
    verifiers: deps.providerVerifiers ?? {
      google: unconfiguredVerifier,
      facebook: unconfiguredVerifier,
    },
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

  app.use(
    "/api/v1",
    createEventRoutes({
      service: createEventService({
        pool: deps.pool,
        ...(deps.realtime && { events: deps.realtime }),
      }),
      queue: createQueueService({
        pool: deps.pool,
        catalog: deps.catalog ?? unconfiguredCatalog,
        logger: deps.logger,
        ...(deps.clock && { clock: deps.clock }),
        ...(deps.realtime && { events: deps.realtime }),
      }),
      jwtSecret: deps.jwtSecret,
      ...(deps.redis && { redis: deps.redis }),
      ...(deps.suggestLimit && { suggestLimit: deps.suggestLimit }),
    }),
  );

  app.use(
    "/api/v1",
    createUserRoutes({
      service: createUserService({ pool: deps.pool }),
      jwtSecret: deps.jwtSecret,
      ...(deps.redis && { redis: deps.redis }),
      ...(deps.userSearchLimit && { searchLimit: deps.userSearchLimit }),
    }),
  );

  app.use(
    "/api/v1",
    createCatalogRoutes({
      service: createCatalogService({
        catalog: deps.catalog ?? unconfiguredCatalog,
        logger: deps.logger,
      }),
      jwtSecret: deps.jwtSecret,
      ...(deps.redis && { redis: deps.redis }),
      ...(deps.catalogSearchLimit && { searchLimit: deps.catalogSearchLimit }),
    }),
  );

  app.use(
    "/api/v1",
    createPlaylistRoutes({
      service: createPlaylistService({ pool: deps.pool }),
      jwtSecret: deps.jwtSecret,
    }),
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler(deps.logger));
  return app;
}
