import type { Profile, ProfileFriendship } from "@music-room/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestError } from "@/api/api-error";
import { MESSAGES } from "@/auth/forms/error-messages";
import { copy } from "@/copy";
import { friendsApi } from "@/features/friends/friends-api";
import { friendStateOf, requestCountLabel } from "@/features/friends/friend-state";
import { friendsErrorMessage } from "@/features/friends/messages";

// Friends in the app (docs/api-contract.md, "Friends"; ADR-023, ADR-042): which action someone's
// profile offers, the count on the Friends row, the error messages, and the calls themselves.

const request = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: { request } }));

const ME = "me-id";
const profileOf = (userId: string, friendship: ProfileFriendship | null): Profile => ({
  userId,
  displayName: "Ada",
  publicInfo: { bio: null },
  friendship,
});

describe("where you stand with someone, from their profile", () => {
  it("no request between you: none", () => {
    expect(friendStateOf(profileOf("ada", null), ME)).toEqual({ kind: "none" });
  });

  it("a request you sent: sent, with its id (to cancel it)", () => {
    const friendship = { id: "r1", status: "pending", direction: "outgoing" } as const;
    expect(friendStateOf(profileOf("ada", friendship), ME)).toEqual({
      kind: "sent",
      requestId: "r1",
    });
  });

  it("a request you received: received, with its id (to accept or decline it)", () => {
    const friendship = { id: "r1", status: "pending", direction: "incoming" } as const;
    expect(friendStateOf(profileOf("ada", friendship), ME)).toEqual({
      kind: "received",
      requestId: "r1",
    });
  });

  it.each(["incoming", "outgoing"] as const)(
    "accepted, whoever asked (%s): friends",
    (direction) => {
      const friendship = { id: "r1", status: "accepted", direction } as const;
      expect(friendStateOf(profileOf("ada", friendship), ME)).toEqual({
        kind: "friends",
      });
    },
  );

  it("your own profile is yourself, never someone to add, whatever it carries", () => {
    expect(friendStateOf(profileOf(ME, null), ME)).toEqual({ kind: "self" });
    const odd = { id: "r1", status: "pending", direction: "outgoing" } as const;
    expect(friendStateOf(profileOf(ME, odd), ME)).toEqual({ kind: "self" });
  });
});

describe("the number of requests on the Friends row", () => {
  it("nothing when there are none", () => {
    expect(requestCountLabel(0, false)).toBeNull();
  });

  it("the number when it is the whole list", () => {
    expect(requestCountLabel(1, false)).toBe("1");
    expect(requestCountLabel(20, false)).toBe("20");
  });

  it("a plus when there is another page", () => {
    expect(requestCountLabel(20, true)).toBe("20+");
  });
});

describe("friends error messages (from the code)", () => {
  const errors = copy.friends.errors;
  it.each([
    [409, "FRIEND_REQUEST_EXISTS", errors.alreadyAsked],
    [409, "ALREADY_FRIENDS", errors.alreadyFriends],
    [404, "FRIENDSHIP_NOT_FOUND", errors.requestGone],
    [404, "USER_NOT_FOUND", errors.personGone],
    [403, "FORBIDDEN", errors.onlyTheyCanAccept],
    [400, "VALIDATION_ERROR", errors.notYourself],
    [429, "RATE_LIMITED", MESSAGES.rateLimited],
    [0, "NETWORK_ERROR", MESSAGES.network],
    [500, "INTERNAL_ERROR", MESSAGES.server],
    [418, "SOMETHING_NEW", copy.errors.unknown],
  ])("%i %s", (status, code, message) => {
    expect(friendsErrorMessage(new RequestError(status, code as never, "x"))).toBe(
      message,
    );
  });

  it("never shows the server's own message", () => {
    const error = new RequestError(409, "ALREADY_FRIENDS", "server text");
    expect(friendsErrorMessage(error)).not.toContain("server text");
  });

  it("anything that is not a request error is the generic message", () => {
    expect(friendsErrorMessage(new Error("boom"))).toBe(copy.errors.unknown);
  });
});

describe("the calls, as in the contract", () => {
  beforeEach(() => request.mockReset().mockResolvedValue(undefined));

  it.each([
    [
      "send",
      () => friendsApi.send("u1"),
      "POST",
      "/friends/requests",
      { body: { userId: "u1" } },
    ],
    [
      "accept",
      () => friendsApi.accept("r1"),
      "POST",
      "/friends/requests/r1/accept",
      undefined,
    ],
    [
      "decline or cancel",
      () => friendsApi.removeRequest("r1"),
      "DELETE",
      "/friends/requests/r1",
      undefined,
    ],
    [
      "unfriend (by the person's id)",
      () => friendsApi.unfriend("u1"),
      "DELETE",
      "/friends/u1",
      undefined,
    ],
    [
      "incoming requests",
      () => friendsApi.requests("incoming"),
      "GET",
      "/friends/requests",
      { query: { direction: "incoming", limit: 20, cursor: undefined } },
    ],
    [
      "the next page of friends",
      () => friendsApi.friends("c2"),
      "GET",
      "/friends",
      { query: { limit: 20, cursor: "c2" } },
    ],
  ])("%s", async (_name, call, method, path, options) => {
    await call();
    expect(request).toHaveBeenCalledWith(method, path, ...(options ? [options] : []));
  });

  it("an id with a slash cannot reach another path", async () => {
    await friendsApi.unfriend("../users/me");
    expect(request).toHaveBeenCalledWith("DELETE", "/friends/..%2Fusers%2Fme");
  });
});

describe("the Friends row, read aloud", () => {
  it.each([
    ["1", "Friends, 1 request waiting"],
    ["2", "Friends, 2 requests waiting"],
    ["20+", "Friends, 20+ requests waiting"],
  ])("%s", (count, label) => {
    expect(copy.profile.friendsWaiting(count)).toBe(label);
  });
});
