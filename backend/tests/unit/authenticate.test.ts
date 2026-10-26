import express from "express";
import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createAuthenticate } from "../../src/middleware/authenticate.js";
import { createErrorHandler } from "../../src/middleware/error-handler.js";
import { signAccessToken } from "../../src/modules/auth/access-token.js";

const SECRET = "s".repeat(32);
const USER_ID = "3f2b8c1e-5d7a-4c1b-9a3e-2b1f6d8e7c90";

// A tiny app with one protected route, to test the middleware in isolation.
const app = express();
app.get("/protected", createAuthenticate(SECRET), (req, res) => {
  res.json({ userId: req.auth?.userId });
});
// Like /users/me or choosing the name: open before the display name is chosen (ADR-046).
app.get(
  "/before-name",
  createAuthenticate(SECRET, { allowWithoutDisplayName: true }),
  (req, res) => {
    res.json({ userId: req.auth?.userId });
  },
);
app.use(createErrorHandler(pino({ level: "silent" })));

describe("authenticate middleware", () => {
  it("lets a valid token through and exposes the user id", async () => {
    const token = await signAccessToken(USER_ID, SECRET, { displayNameSet: true });

    const response = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: USER_ID });
  });

  it("answers 403 DISPLAY_NAME_REQUIRED before the display name is chosen (ADR-046)", async () => {
    const token = await signAccessToken(USER_ID, SECRET, { displayNameSet: false });

    const response = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("DISPLAY_NAME_REQUIRED");
  });

  it("lets that account through only where it may choose its name", async () => {
    const token = await signAccessToken(USER_ID, SECRET, { displayNameSet: false });

    const response = await request(app)
      .get("/before-name")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: USER_ID });
  });

  it("still refuses a bad token on the routes open before the name", async () => {
    const response = await request(app)
      .get("/before-name")
      .set("Authorization", "Bearer not-a-token");

    expect(response.status).toBe(401);
  });

  it("answers 401 UNAUTHENTICATED when there is no Authorization header", async () => {
    const response = await request(app).get("/protected");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it.each(["Bearer", "Bearer ", "Basic abc123", "abc123", "Bearer a b"])(
    "answers 401 UNAUTHENTICATED for the header %j",
    async (header) => {
      const response = await request(app).get("/protected").set("Authorization", header);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    },
  );

  it("answers 401 UNAUTHENTICATED for a token signed with another secret", async () => {
    const token = await signAccessToken(USER_ID, "o".repeat(32), {
      displayNameSet: true,
    });

    const response = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("answers 401 TOKEN_EXPIRED for an expired token, so the app knows to refresh", async () => {
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
    const token = await signAccessToken(
      USER_ID,
      SECRET,
      { displayNameSet: true },
      twentyMinutesAgo,
    );

    const response = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("TOKEN_EXPIRED");
  });

  it("accepts the scheme in any letter case (RFC 7235)", async () => {
    const token = await signAccessToken(USER_ID, SECRET, { displayNameSet: true });

    const response = await request(app)
      .get("/protected")
      .set("Authorization", `bearer ${token}`);

    expect(response.status).toBe(200);
  });
});
