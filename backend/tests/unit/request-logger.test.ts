import express from "express";
import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { parseClientInfo } from "../../src/middleware/client-info.js";
import { createRequestLogger } from "../../src/middleware/request-logger.js";

function appWithCapturedLogs() {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: "debug" },
    { write: (chunk: string) => lines.push(JSON.parse(chunk)) },
  );
  const app = express();
  app.use(createRequestLogger(logger));
  app.get("/ok", (_req, res) => void res.json({}));
  app.get("/health", (_req, res) => void res.json({}));
  app.get("/secret-user", (req, res) => {
    req.auth = { userId: "user-1" };
    res.json({});
  });
  app.get("/boom", (_req, res) => void res.status(500).json({}));
  return { app, lines };
}

describe("request logger", () => {
  it("logs platform, device and app version for a request", async () => {
    const { app, lines } = appWithCapturedLogs();
    await request(app).get("/ok").set({
      "X-Platform": "ios",
      "X-Device": "iPhone 15 Pro",
      "X-App-Version": "1.2.3",
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      msg: "request completed",
      method: "GET",
      path: "/ok",
      status: 200,
      client: { platform: "ios", device: "iPhone 15 Pro", appVersion: "1.2.3" },
    });
    expect(typeof lines[0]?.durationMs).toBe("number");
    expect(typeof lines[0]?.requestId).toBe("string");
  });

  it("never logs the query string, which can carry secrets", async () => {
    const { app, lines } = appWithCapturedLogs();
    await request(app).get("/ok?token=hunter2");

    expect(lines[0]?.path).toBe("/ok");
    expect(JSON.stringify(lines)).not.toContain("hunter2");
  });

  it("logs the user id when the route authenticated one", async () => {
    const { app, lines } = appWithCapturedLogs();
    await request(app).get("/secret-user");

    expect(lines[0]?.userId).toBe("user-1");
  });

  it("logs requests that no route handles (404) at warn level", async () => {
    const { app, lines } = appWithCapturedLogs();
    await request(app).get("/nope");

    expect(lines[0]).toMatchObject({ status: 404, level: 40 });
  });

  it("logs server errors at error level", async () => {
    const { app, lines } = appWithCapturedLogs();
    await request(app).get("/boom");

    expect(lines[0]).toMatchObject({ status: 500, level: 50 });
  });

  it("keeps health checks out of the info logs", async () => {
    const { app, lines } = appWithCapturedLogs();
    await request(app).get("/health");

    expect(lines[0]?.level).toBe(20);
  });
});

describe("parseClientInfo", () => {
  const from = (headers: Record<string, string>) =>
    parseClientInfo((name) => headers[name]);

  it("falls back to unknown when the headers are missing", () => {
    expect(from({})).toEqual({
      platform: "unknown",
      device: "unknown",
      appVersion: "unknown",
    });
  });

  it("accepts the platform in any case and rejects unknown platforms", () => {
    expect(from({ "x-platform": "Android" }).platform).toBe("android");
    expect(from({ "x-platform": "symbian" }).platform).toBe("unknown");
  });

  it("strips characters that could forge log lines", () => {
    const info = from({ "x-device": 'Pixel"\n{"level":60}', "x-app-version": "1.0\r\n" });
    expect(info.device).not.toMatch(/[\n\r"{}]/);
    expect(info.appVersion).toBe("1.0");
  });

  it("caps the length of each value", () => {
    expect(from({ "x-device": "a".repeat(500) }).device).toHaveLength(64);
  });

  it("treats a value made only of unsafe characters as unknown", () => {
    expect(from({ "x-device": "\n\n" }).device).toBe("unknown");
  });
});
