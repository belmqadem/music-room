import express from "express";
import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createErrorHandler,
  notFoundHandler,
} from "../../src/middleware/error-handler.js";
import { HttpError } from "../../src/http-error.js";

// One route per kind of failure, to check how each is turned into a response.
const app = express();
app.use(express.json());
app.get("/http-error", () => {
  throw new HttpError(409, "EMAIL_TAKEN", "An account with this email already exists.", {
    a: 1,
  });
});
app.post("/zod", () => {
  z.strictObject({ password: z.string().min(40) }).parse({
    password: "hunter2-secret-value",
  });
});
app.get("/boom", () => {
  throw new Error("SELECT * FROM users failed: connection string postgres://u:p@db");
});
app.get("/async-boom", async () => {
  await Promise.resolve();
  throw new Error("secret internal detail");
});
app.use(notFoundHandler);
app.use(createErrorHandler(pino({ level: "silent" })));

describe("error handler", () => {
  it("turns an HttpError into its status and the contract's body", async () => {
    const response = await request(app).get("/http-error");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        code: "EMAIL_TAKEN",
        message: "An account with this email already exists.",
        details: { a: 1 },
      },
    });
  });

  it("turns a validation error into 400 VALIDATION_ERROR with field paths", async () => {
    const response = await request(app).post("/zod").send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.details[0]).toHaveProperty("path", "password");
  });

  it("never echoes the submitted values in validation errors", async () => {
    const response = await request(app).post("/zod").send({});

    expect(JSON.stringify(response.body)).not.toContain("hunter2-secret-value");
  });

  it("answers malformed JSON with 400 VALIDATION_ERROR (not a stack trace)", async () => {
    const response = await request(app)
      .post("/zod")
      .set("Content-Type", "application/json")
      .send("{not json");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it.each(["/boom", "/async-boom"])(
    "hides internals of an unexpected error on %s",
    async (path) => {
      const response = await request(app).get(path);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: {
          code: "INTERNAL_ERROR",
          message: "Something went wrong.",
          details: null,
        },
      });
      expect(response.text).not.toMatch(/SELECT|postgres:\/\/|secret internal/);
    },
  );

  it("answers an unknown route with a JSON 404", async () => {
    const response = await request(app).get("/nope");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});
