import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestError } from "@/api/api-error";
import { MESSAGES } from "@/auth/forms/error-messages";
import {
  normalizeUsername,
  saveUsername,
  usernameError,
  usernameSaveErrorMessage,
} from "@/auth/username";
import { copy } from "@/copy";
// The backend's own rule, to prove the app agrees with it (tests only; the app never ships it).
import { setDisplayNameSchema } from "../../backend/src/modules/auth/schema";

// The username (the API's displayName, ADR-046): the app's checks, the save (and the refresh that
// lets the account in everywhere), and the messages.

const auth = vi.hoisted(() => ({ request: vi.fn(), refreshAccessToken: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const errors = copy.username.errors;

describe("what the app says about a name before sending it", () => {
  it.each([
    ["", errors.empty],
    ["   ", errors.empty],
    ["ada lovelace", errors.characters],
    ["ada-l", errors.characters],
    ["élodie", errors.characters],
    ["аda", errors.characters],
    ["1ada", errors.firstLetter],
    ["_ada", errors.firstLetter],
    ["ab", errors.length(3, 20)],
    ["a".repeat(21), errors.length(3, 20)],
    ["user_1a2b3c4d5e6f", errors.reserved],
  ])("%j: %s", (input, message) => {
    expect(usernameError(input)).toBe(message);
  });

  it.each(["ada", "  Ada  ", "ADA.Lovelace_42", "abc", "a".repeat(20), "users"])(
    "%j is fine",
    (input) => {
      expect(usernameError(input)).toBeNull();
    },
  );

  it("normalizes as the server stores it: trimmed and lowercased", () => {
    expect(normalizeUsername("  Ada.L ")).toBe("ada.l");
  });
});

describe("the app accepts exactly what the backend accepts", () => {
  it.each([
    "ada",
    "  Ada  ",
    "ADA.Lovelace_42",
    "ab",
    "abc",
    "a".repeat(20),
    "a".repeat(21),
    "1ada",
    ".ada",
    "_ada",
    "ada lovelace",
    "ada-l",
    "élodie",
    "аda",
    "ada\u{1F3B5}",
    "user_1a2b3c4d5e6f",
    "user",
    "users",
    "",
    "   ",
  ])("%j", (input) => {
    const backend = setDisplayNameSchema.safeParse({ displayName: input });
    expect(usernameError(input) === null).toBe(backend.success);
    if (backend.success) expect(normalizeUsername(input)).toBe(backend.data.displayName);
  });
});

describe("saving", () => {
  beforeEach(() => {
    auth.request
      .mockReset()
      .mockResolvedValue({ displayName: "ada", displayNameSet: true });
    auth.refreshAccessToken.mockReset().mockResolvedValue(true);
  });

  it("sends the normalized name, then refreshes so the new token says it is set", async () => {
    await saveUsername("  Ada ");

    expect(auth.request).toHaveBeenCalledWith("PUT", "/users/me/display-name", {
      body: { displayName: "ada" },
    });
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(auth.request.mock.invocationCallOrder[0]).toBeLessThan(
      auth.refreshAccessToken.mock.invocationCallOrder[0]!,
    );
  });

  it("does not refresh when the server refused the name", async () => {
    auth.request.mockRejectedValue(new RequestError(409, "DISPLAY_NAME_TAKEN", "x"));

    await expect(saveUsername("ada")).rejects.toBeInstanceOf(RequestError);
    expect(auth.refreshAccessToken).not.toHaveBeenCalled();
  });
});

describe("save errors (from the code)", () => {
  it.each([
    [409, "DISPLAY_NAME_TAKEN", errors.taken],
    [400, "VALIDATION_ERROR", errors.rejected],
    [0, "NETWORK_ERROR", MESSAGES.network],
    [429, "RATE_LIMITED", MESSAGES.rateLimited],
    [500, "INTERNAL_ERROR", MESSAGES.server],
    [418, "SOMETHING_NEW", copy.errors.unknown],
  ])("%i %s", (status, code, message) => {
    const text = usernameSaveErrorMessage(
      new RequestError(status, code as never, "server text"),
    );
    expect(text).toBe(message);
    expect(text).not.toContain("server text");
  });
});
