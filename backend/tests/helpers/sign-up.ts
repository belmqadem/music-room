import type { Express } from "express";
import request from "supertest";
import { expect } from "vitest";
import type { createMemoryMailer } from "./memory-mailer.js";

/**
 * The whole sign-up path a real user follows: register, read the code from the email, confirm
 * it, log in. Returns the login response (the session), for tests that just need a user.
 */
export async function signUpVerified(
  app: Express,
  mailer: ReturnType<typeof createMemoryMailer>,
  account: { email: string; password: string; displayName: string },
) {
  const registered = await request(app).post("/api/v1/auth/register").send(account);
  expect(registered.status, JSON.stringify(registered.body)).toBe(201);
  const verified = await request(app)
    .post("/api/v1/auth/verify-email")
    .send({ email: account.email, code: mailer.lastCodeFor(account.email) });
  expect(verified.status, JSON.stringify(verified.body)).toBe(204);
  const session = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: account.email, password: account.password });
  expect(session.status, JSON.stringify(session.body)).toBe(200);
  return session;
}
