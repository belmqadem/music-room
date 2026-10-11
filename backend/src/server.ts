import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadConfig, loadEnvFileIfPresent } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { assertPostgresReachable, createPostgresPool } from "./db/postgres.js";
import { createRedisClient } from "./db/redis.js";
import { createProviderVerifiers } from "./modules/auth/providers.js";
import { attachSockets } from "./sockets/index.js";

// Entry point: the only place that reads the environment, opens connections
// and listens. Any failure during startup exits the process with code 1.
async function main(): Promise<void> {
  loadEnvFileIfPresent();
  const config = loadConfig(process.env);
  const logger = createLogger(config);

  const pool = createPostgresPool(config.DATABASE_URL);
  const redis = createRedisClient(config.REDIS_URL);
  await assertPostgresReachable(pool);
  await redis.connect();

  const app = createApp({
    pool,
    redis,
    logger,
    jwtSecret: config.JWT_ACCESS_SECRET,
    providerVerifiers: createProviderVerifiers(config, logger),
  });
  const httpServer = createServer(app);
  const io = attachSockets(httpServer, { jwtSecret: config.JWT_ACCESS_SECRET, logger });

  httpServer.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, "server listening");
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "shutting down");
    io.close();
    httpServer.close(() => {
      void Promise.all([pool.end(), redis.quit()]).then(() => process.exit(0));
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
