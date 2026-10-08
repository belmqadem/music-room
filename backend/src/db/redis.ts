import { Redis } from "ioredis";

/**
 * Creates a Redis client without connecting (lazyConnect): the caller decides
 * when to connect, so importing this module never has side effects.
 * Callers own the client and must call `quit()` on shutdown.
 */
export function createRedisClient(redisUrl: string): Redis {
  return new Redis(redisUrl, { lazyConnect: true });
}
