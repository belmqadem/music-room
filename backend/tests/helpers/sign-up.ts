import { randomBytes } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { expect } from "vitest";
import type { createMemoryMailer } from "./memory-mailer.js";

/** A display name no other test (or test file running at the same time) uses (ADR-046 rules). */
export const testDisplayName = () => `t${randomBytes(6).toString("hex")}`;

/**
 * Chooses a display name for the session's user, as the app does right after sign-up (ADR-046),
 * then refreshes: the new access token says the name is set, so every endpoint lets it in.
 * Returns the refresh response (the new session).
 */
export async function withDisplayName(
  app: Express,
  session: { accessToken: string; refreshToken: string },
  displayName: string = testDisplayName(),
) {
  const chosen = await request(app)
    .put("/api/v1/users/me/display-name")
    .set("Authorization", `Bearer ${session.accessToken}`)
    .send({ displayName });
  expect(chosen.status, JSON.stringify(chosen.body)).toBe(200);
  const refreshed = await request(app)
    .post("/api/v1/auth/refresh")
    .send({ refreshToken: session.refreshToken });
  expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200);
  return refreshed;
}

/**
 * The whole sign-up path a real user follows: register, read the code from the email, confirm
 * it, log in, choose a display name. Returns the last session, for tests that just need a user.
 * `chooseName: false` stops after the login (the account then has a temporary name).
 */
export async function signUpVerified(
  app: Express,
  mailer: ReturnType<typeof createMemoryMailer>,
  account: { email: string; password: string },
  options: { chooseName?: boolean } = {},
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
  if (options.chooseName === false) return session;
  return withDisplayName(app, session.body);
}
