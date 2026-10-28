import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestError } from "@/api/api-error";
import { MESSAGES } from "@/auth/forms/error-messages";
import { copy } from "@/copy";
import { invitationErrorMessage } from "@/features/invitations/messages";
import {
  isPremium,
  planErrorMessage,
  playlistEditing,
  switchPlan,
} from "@/features/plan/plan";
import { playlistErrorMessage } from "@/features/playlist-editor/messages";
import { trackVoteErrorMessage } from "@/features/track-vote/messages";

// Free and Premium in the app (ADR-048): what it shows, the switch, and the server's refusal. The
// server checks every request; these only decide what a Free user is shown.

const auth = vi.hoisted(() => ({ request: vi.fn(), refreshUser: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

describe("who is Premium", () => {
  it.each([
    [{ plan: "premium" as const }, true],
    [{ plan: "free" as const }, false],
    [null, false],
    [undefined, false],
  ])("%j: %s", (user, expected) => {
    expect(isPremium(user)).toBe(expected);
  });
});

describe("editing a playlist needs its license AND Premium", () => {
  it("the license allows it, Premium: allowed", () => {
    expect(playlistEditing(true, { plan: "premium" })).toBe("allowed");
  });

  it("the license allows it, Free: shown as a Premium feature", () => {
    expect(playlistEditing(true, { plan: "free" })).toBe("needs-premium");
  });

  it("the license does not allow it: not allowed, whatever the plan (Premium would not help)", () => {
    expect(playlistEditing(false, { plan: "premium" })).toBe("not-allowed");
    expect(playlistEditing(false, { plan: "free" })).toBe("not-allowed");
  });
});

describe("switching", () => {
  beforeEach(() => {
    auth.request.mockReset().mockResolvedValue({});
    auth.refreshUser.mockReset().mockResolvedValue({});
  });

  it("sends the plan, then reads the user again so the app follows", async () => {
    await switchPlan("premium");

    expect(auth.request).toHaveBeenCalledWith("PUT", "/users/me/plan", {
      body: { plan: "premium" },
    });
    expect(auth.refreshUser).toHaveBeenCalledTimes(1);
  });

  it("does not read the user again when the switch failed", async () => {
    auth.request.mockRejectedValue(new RequestError(0, "NETWORK_ERROR", "x"));

    await expect(switchPlan("free")).rejects.toBeInstanceOf(RequestError);
    expect(auth.refreshUser).not.toHaveBeenCalled();
  });

  it.each([
    [0, "NETWORK_ERROR", MESSAGES.network],
    [429, "RATE_LIMITED", MESSAGES.rateLimited],
    [500, "INTERNAL_ERROR", MESSAGES.server],
    [400, "VALIDATION_ERROR", copy.errors.unknown],
  ])("a failed switch: %i %s", (status, code, message) => {
    expect(planErrorMessage(new RequestError(status, code as never, "server text"))).toBe(
      message,
    );
  });
});

describe("the server's PREMIUM_REQUIRED says the same everywhere", () => {
  const refused = new RequestError(403, "PREMIUM_REQUIRED", "server text");

  it.each([
    ["playlists", playlistErrorMessage],
    ["rooms", trackVoteErrorMessage],
    ["invitations", invitationErrorMessage],
  ])("%s", (_area, message) => {
    expect(message(refused)).toBe(copy.plan.required);
  });
});
