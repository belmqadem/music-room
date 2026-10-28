import { Redis } from "ioredis";
import pino from "pino";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";

// The rate limiter against a REAL Redis (set TEST_REDIS_URL; otherwise skipped).
// Two separate app instances stand in for two server processes.
const redisUrl = process.env.TEST_REDIS_URL;
const KEY_PATTERN = "rate-limit:login:*";

describe.skipIf(!redisUrl)("rate limiting with the Redis store", () => {
  let redis: Redis;
  // The pool is lazy and these requests are rejected before touching the database.
  const pool = createPostgresPool("postgres://nobody:nothing@localhost:1/none");

  const buildApp = () =>
    createApp({
      pool,
      redis,
      jwtSecret: "s".repeat(32),
      logger: pino({ level: "silent" }),
      passwordCost: 4,
      loginLimit: { windowMs: 60_000, limit: 2 },
    });
  // An invalid body gets 400 from validation, but it still counts toward the limit.
  const hit = (app: ReturnType<typeof buildApp>) =>
    request(app).post("/api/v1/auth/login").send({});

  async function clearKeys() {
    const keys = await redis.keys(KEY_PATTERN);
    if (keys.length > 0) await redis.del(...keys);
  }

  beforeAll(async () => {
    redis = new Redis(redisUrl!);
    await clearKeys();
  });
  afterEach(clearKeys);
  afterAll(async () => {
    await redis.quit();
    await pool.end();
  });

  it("stores the counter in Redis and blocks after the limit", async () => {
    const app = buildApp();

    const statuses = [
      (await hit(app)).status,
      (await hit(app)).status,
      (await hit(app)).status,
    ];

    expect(statuses).toEqual([400, 400, 429]);
    expect(await redis.keys(KEY_PATTERN)).toHaveLength(1);
  });

  it("shares the count between two server instances", async () => {
    const serverA = buildApp();
    const serverB = buildApp();

    await hit(serverA);
    await hit(serverA);
    const onOtherServer = await hit(serverB);

    expect(onOtherServer.status).toBe(429);
  });

  it("keeps the count when a server restarts (new app, same Redis)", async () => {
    await hit(buildApp());
    await hit(buildApp());

    const afterRestart = await hit(buildApp());

    expect(afterRestart.status).toBe(429);
  });

  it("sets an expiry on the counter so keys do not pile up forever", async () => {
    await hit(buildApp());

    const [key] = await redis.keys(KEY_PATTERN);
    const ttl = await redis.pttl(key!);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });
});
