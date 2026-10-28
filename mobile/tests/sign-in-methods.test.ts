import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestError } from "@/api/api-error";
import { MESSAGES } from "@/auth/forms/error-messages";
import { copy } from "@/copy";
import {
  accountsApi,
  canUnlink,
  hasAnyProof,
  loginMethodCount,
  proofOptions,
  signInMethodErrorMessage,
} from "@/settings/sign-in-methods";

// Sign-in methods (ADR-025, ADR-044): what the app offers for linking and unlinking, the calls,
// and the messages. The server still decides; these only keep the app from offering what can't work.

const request = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: { request } }));

const account = (
  hasPassword: boolean,
  ...linkedProviders: ("google" | "facebook")[]
) => ({
  hasPassword,
  linkedProviders,
});

describe("login methods, counted as the server counts them", () => {
  it.each([
    [account(true), 1],
    [account(true, "google"), 2],
    [account(false, "google"), 1],
    [account(false, "google", "facebook"), 2],
    [account(true, "google", "facebook"), 3],
  ])("%j: %i", (user, count) => {
    expect(loginMethodCount(user)).toBe(count);
  });
});

describe("when Unlink is offered", () => {
  it("not for your only way to sign in", () => {
    expect(canUnlink(account(false, "google"), "google")).toBe(false);
  });

  it("when a password is left", () => {
    expect(canUnlink(account(true, "google"), "google")).toBe(true);
  });

  it("when another provider is left, with no password", () => {
    expect(canUnlink(account(false, "google", "facebook"), "facebook")).toBe(true);
  });

  it("never for a provider that isn't linked", () => {
    expect(canUnlink(account(true, "google"), "facebook")).toBe(false);
  });
});

describe("the proofs offered", () => {
  it("the password only to an account that has one", () => {
    expect(proofOptions(account(true), ["google"]).password).toBe(true);
    expect(proofOptions(account(false, "google"), ["google"]).password).toBe(false);
  });

  it("only linked providers this build can sign in with", () => {
    expect(
      proofOptions(account(false, "google", "facebook"), ["google"]).providers,
    ).toEqual(["google"]);
    expect(proofOptions(account(true), ["google", "facebook"]).providers).toEqual([]);
  });

  it("a social-only account in a build without its SDK has no proof here", () => {
    expect(hasAnyProof(proofOptions(account(false, "facebook"), ["google"]))).toBe(false);
    expect(hasAnyProof(proofOptions(account(true), []))).toBe(true);
  });
});

describe("the calls, as in the contract", () => {
  beforeEach(() => request.mockReset().mockResolvedValue({}));

  it("link: POST with the new credential and the proof", async () => {
    const body = {
      credential: "new",
      reauth: { method: "password", password: "pw" },
    } as const;
    await accountsApi.link("google", body);
    expect(request).toHaveBeenCalledWith("POST", "/users/me/providers/google", { body });
  });

  it("unlink: DELETE with the proof in the body", async () => {
    const body = {
      reauth: { method: "provider", provider: "google", credential: "fresh" },
    } as const;
    await accountsApi.unlink("facebook", body);
    expect(request).toHaveBeenCalledWith("DELETE", "/users/me/providers/facebook", {
      body,
    });
  });
});

describe("messages (from the code)", () => {
  const errors = copy.settings.signIn.errors;
  const failure = (status: number, code: string) =>
    new RequestError(status, code as never, "server text");

  it("a refused proof says which: the password, or an account that isn't yours", () => {
    expect(
      signInMethodErrorMessage(failure(403, "REAUTH_FAILED"), "Google", "password"),
    ).toBe(errors.wrongPassword);
    expect(
      signInMethodErrorMessage(failure(403, "REAUTH_FAILED"), "Google", "provider"),
    ).toBe(errors.proofNotLinked);
  });

  it.each([
    [409, "PROVIDER_ACCOUNT_LINKED", errors.alreadyLinked("Google")],
    [409, "LAST_LOGIN_METHOD", errors.lastMethod],
    [404, "NOT_FOUND", errors.notLinked("Google")],
    [401, "INVALID_PROVIDER_CREDENTIAL", copy.auth.social.notConfirmed("Google")],
    [502, "PROVIDER_UNAVAILABLE", errors.providerDown("Google")],
    [429, "RATE_LIMITED", MESSAGES.rateLimited],
    [0, "NETWORK_ERROR", MESSAGES.network],
    [500, "INTERNAL_ERROR", MESSAGES.server],
    [418, "SOMETHING_NEW", copy.errors.unknown],
  ])("%i %s", (status, code, message) => {
    const text = signInMethodErrorMessage(failure(status, code), "Google", "password");
    expect(text).toBe(message);
    expect(text).not.toContain("server text");
  });

  it("anything that is not a request error is the generic message", () => {
    expect(signInMethodErrorMessage(new Error("x"), "Google", "password")).toBe(
      copy.errors.unknown,
    );
  });
});
