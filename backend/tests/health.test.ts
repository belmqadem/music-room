import request from "supertest";
import { describe, expect, it } from "vitest";
import pino from "pino";
import { createApp } from "../src/app.js";
import { createPostgresPool } from "../src/db/postgres.js";

// The pool is lazy (it never connects unless queried), so /health needs no database.
const app = createApp({
  pool: createPostgresPool("postgres://nobody:nothing@localhost:1/none"),
  jwtSecret: "t".repeat(32),
  logger: pino({ level: "silent" }),
});

describe("GET /health", () => {
  it("returns 200 and { status: 'ok' } without needing any database", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("serves the OpenAPI UI at /docs", async () => {
    const response = await request(app).get("/docs/");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
  });

  it("returns a JSON 404 in the contract's error format for unknown routes", async () => {
    const response = await request(app).get("/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: "NOT_FOUND", message: "Route not found.", details: null },
    });
  });

  it("does not advertise the framework in headers", async () => {
    const response = await request(app).get("/health");

    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});
