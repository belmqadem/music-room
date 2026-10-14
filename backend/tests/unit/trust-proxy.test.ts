import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";

// Which address the per-IP rate limits count. The login limiter runs BEFORE the handler, and
// an empty body is a 400 that never touches the database, so this needs no Postgres: a
// request is "counted" if the first one passes (400) and the second is refused (429).
function appWith(trustProxy?: number) {
  return createApp({
    pool: createPostgresPool("postgres://nobody:nothing@localhost:1/none"),
    jwtSecret: "t".repeat(32),
    logger: pino({ level: "silent" }),
    loginLimit: { windowMs: 60_000, limit: 1 },
    ...(trustProxy !== undefined && { trustProxy }),
  });
}

const login = (app: ReturnType<typeof appWith>, forwardedFor?: string) => {
  const req = request(app).post("/api/v1/auth/login").send({});
  return forwardedFor ? req.set("X-Forwarded-For", forwardedFor) : req;
};

describe("trust proxy and the per-IP limits", () => {
  it("by default IGNORES X-Forwarded-For: a client cannot pick its own address", async () => {
    const app = appWith();

    const first = await login(app, "10.0.0.1");
    const second = await login(app, "10.0.0.2"); // a different claimed address, same real client

    expect(first.status).toBe(400);
    expect(second.status).toBe(429);
  });

  it("with one trusted proxy, counts each client address separately", async () => {
    const app = appWith(1);

    const statuses = [];
    for (const address of ["10.0.0.1", "10.0.0.2", "10.0.0.3"]) {
      statuses.push((await login(app, address)).status);
    }
    const repeated = await login(app, "10.0.0.1");

    expect(statuses).toEqual([400, 400, 400]);
    expect(repeated.status).toBe(429); // the same address is still limited
  });

  it("with one trusted proxy, only the address the PROXY added counts: invented extra entries are ignored", async () => {
    const app = appWith(1);

    const first = await login(app, "1.1.1.1, 9.9.9.9"); // the proxy saw the client as 9.9.9.9
    const second = await login(app, "2.2.2.2, 9.9.9.9"); // the client invented a different first entry

    expect(first.status).toBe(400);
    expect(second.status).toBe(429);
  });
});
