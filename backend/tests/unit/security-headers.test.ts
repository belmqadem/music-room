import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { docsEnabled, loadConfig } from "../../src/config/env.js";
import { createPostgresPool } from "../../src/db/postgres.js";

// ADR-027. The pool is lazy (it never connects unless queried), so these routes need no database.
function appWith(options: { trustProxy?: number; docsEnabled?: boolean } = {}) {
  return createApp({
    pool: createPostgresPool("postgres://nobody:nothing@localhost:1/none"),
    jwtSecret: "t".repeat(32),
    logger: pino({ level: "silent" }),
    ...options,
  });
}

describe("security headers", () => {
  const app = appWith();

  it.each([
    ["a normal answer", () => request(app).get("/health"), 200],
    ["an unknown route", () => request(app).get("/nothing"), 404],
    ["a refused request (no token)", () => request(app).get("/api/v1/events"), 401],
    [
      "a malformed body",
      () =>
        request(app)
          .post("/api/v1/auth/login")
          .set("Content-Type", "application/json")
          .send("{"),
      400,
    ],
  ])("are on %s", async (_label, send, status) => {
    const response = await send();

    expect(response.status).toBe(status);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["content-security-policy"]).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("are on a rate-limited answer too", async () => {
    const limited = createApp({
      pool: createPostgresPool("postgres://nobody:nothing@localhost:1/none"),
      jwtSecret: "t".repeat(32),
      logger: pino({ level: "silent" }),
      loginLimit: { windowMs: 60_000, limit: 1 },
    });
    await request(limited).post("/api/v1/auth/login").send({});

    const response = await request(limited).post("/api/v1/auth/login").send({});

    expect(response.status).toBe(429);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("leave the Swagger UI free to run its own scripts, but still stop sniffing", async () => {
    const response = await request(app).get("/docs/");

    expect(response.status).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toBeUndefined();
  });

  it("do not exempt a path that merely starts with /docs", async () => {
    const response = await request(app).get("/docs-evil");

    expect(response.status).toBe(404);
    expect(response.headers["content-security-policy"]).toBeDefined();
  });
});

describe("Strict-Transport-Security", () => {
  it("is not sent over plain http", async () => {
    const response = await request(appWith()).get("/health");

    expect(response.headers["strict-transport-security"]).toBeUndefined();
  });

  it("is sent when a trusted proxy says the request came over https", async () => {
    const response = await request(appWith({ trustProxy: 1 }))
      .get("/health")
      .set("X-Forwarded-Proto", "https");

    expect(response.headers["strict-transport-security"]).toBe(
      "max-age=15552000; includeSubDomains",
    );
  });

  it("is not sent when the trusted proxy says http", async () => {
    const response = await request(appWith({ trustProxy: 1 }))
      .get("/health")
      .set("X-Forwarded-Proto", "http");

    expect(response.headers["strict-transport-security"]).toBeUndefined();
  });

  it("cannot be forced by a client that claims https when no proxy is trusted", async () => {
    const response = await request(appWith({ trustProxy: 0 }))
      .get("/health")
      .set("X-Forwarded-Proto", "https");

    expect(response.headers["strict-transport-security"]).toBeUndefined();
  });
});

describe("the API documentation switch", () => {
  it("serves /docs by default", async () => {
    expect((await request(appWith()).get("/docs/")).status).toBe(200);
  });

  it("answers 404 in the contract's error shape when switched off", async () => {
    const response = await request(appWith({ docsEnabled: false })).get("/docs/");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("does not hide the API itself when /docs is off", async () => {
    expect((await request(appWith({ docsEnabled: false })).get("/health")).status).toBe(
      200,
    );
  });
});

describe("docsEnabled (configuration)", () => {
  const base = {
    DATABASE_URL: "postgres://u:p@localhost:5432/db",
    REDIS_URL: "redis://localhost:6379",
    JWT_ACCESS_SECRET: "x".repeat(32),
  };

  it("is on in development and test, off in production", () => {
    for (const [env, expected] of [
      ["development", true],
      ["test", true],
    ] as const) {
      expect(docsEnabled(loadConfig({ ...base, NODE_ENV: env }))).toBe(expected);
    }
    expect(
      docsEnabled(
        loadConfig({
          ...base,
          NODE_ENV: "production",
          MAIL_TRANSPORT: "smtp",
          SMTP_URL: "smtp://localhost:1025",
        }),
      ),
    ).toBe(false);
  });

  it("can be switched explicitly either way", () => {
    expect(docsEnabled(loadConfig({ ...base, DOCS_ENABLED: "false" }))).toBe(false);
    expect(
      docsEnabled(
        loadConfig({
          ...base,
          NODE_ENV: "production",
          MAIL_TRANSPORT: "smtp",
          SMTP_URL: "smtp://localhost:1025",
          DOCS_ENABLED: "true",
        }),
      ),
    ).toBe(true);
  });

  it("rejects a value that is not true or false", () => {
    expect(() => loadConfig({ ...base, DOCS_ENABLED: "maybe" })).toThrowError(
      /DOCS_ENABLED/,
    );
  });
});
