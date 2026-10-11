import request from "supertest";
import { describe, expect, it } from "vitest";
import pino from "pino";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";

// The pool is lazy (it never connects unless queried), so these routes need no database.
function appAllowing(allowedOrigins?: string[]) {
  return createApp({
    pool: createPostgresPool("postgres://nobody:nothing@localhost:1/none"),
    jwtSecret: "t".repeat(32),
    logger: pino({ level: "silent" }),
    ...(allowedOrigins && { allowedOrigins }),
  });
}

const WEB = "http://localhost:8081";
const EVIL = "https://evil.example";

describe("CORS allow-list", () => {
  const app = appAllowing([WEB]);

  it("lets a listed origin read the response, and tells caches the answer depends on Origin", async () => {
    const response = await request(app).get("/health").set("Origin", WEB);

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(WEB);
    expect(response.headers["vary"]).toMatch(/Origin/);
  });

  it("gives an unlisted origin no permission", async () => {
    const response = await request(app).get("/health").set("Origin", EVIL);

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not treat a look-alike of a listed origin as listed", async () => {
    for (const origin of [
      `${WEB}.evil.example`,
      "http://localhost:8082",
      "https://localhost:8081",
    ]) {
      const response = await request(app).get("/health").set("Origin", origin);
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    }
  });

  it("answers the preflight of a listed origin with the headers the app sends", async () => {
    const response = await request(app)
      .options("/api/v1/auth/login")
      .set("Origin", WEB)
      .set("Access-Control-Request-Method", "POST")
      .set(
        "Access-Control-Request-Headers",
        "authorization,content-type,x-platform,x-device,x-app-version",
      );

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(WEB);
    const allowed = String(
      response.headers["access-control-allow-headers"],
    ).toLowerCase();
    for (const header of [
      "authorization",
      "content-type",
      "x-platform",
      "x-device",
      "x-app-version",
    ]) {
      expect(allowed).toContain(header);
    }
    expect(response.headers["access-control-allow-methods"]).toContain("DELETE");
  });

  it("gives the preflight of an unlisted origin no permission", async () => {
    const response = await request(app)
      .options("/api/v1/auth/login")
      .set("Origin", EVIL)
      .set("Access-Control-Request-Method", "POST");

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("never allows credentials: authentication uses a bearer token, not cookies", async () => {
    const response = await request(app).get("/health").set("Origin", WEB);

    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("leaves requests without an Origin header (the mobile app) untouched", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows no browser origin at all when none is configured", async () => {
    for (const unconfigured of [appAllowing(), appAllowing([])]) {
      const response = await request(unconfigured).get("/health").set("Origin", WEB);
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    }
  });

  it("never answers with a wildcard", async () => {
    const response = await request(app).get("/health").set("Origin", EVIL);

    expect(response.headers["access-control-allow-origin"]).not.toBe("*");
  });
});
