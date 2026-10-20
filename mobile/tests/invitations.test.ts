import type { Invitation } from "@music-room/shared";
import { describe, expect, it } from "vitest";
import { RequestError } from "@/api/api-error";
import { MESSAGES } from "@/auth/forms/error-messages";
import {
  invitedIds,
  withInvitation,
  withNextPage,
  withoutInvitee,
} from "@/features/invitations/invitation-list";
import {
  INVITATION_MESSAGES,
  invitationErrorMessage,
} from "@/features/invitations/messages";

const invitation = (userId: string, at = "2026-10-20T10:00:00Z"): Invitation => ({
  resourceId: "e1",
  user: { id: userId, displayName: `User ${userId}` },
  invitedAt: at,
});
const ids = (list: Invitation[]) => list.map((i) => i.user.id);

describe("the invited list", () => {
  it("puts a new invitation first (newest first, like the server)", () => {
    expect(
      ids(withInvitation([invitation("a"), invitation("b")], invitation("c"))),
    ).toEqual(["c", "a", "b"]);
  });

  it("never lists someone twice when they are invited again", () => {
    expect(
      ids(withInvitation([invitation("a"), invitation("b")], invitation("b"))),
    ).toEqual(["b", "a"]);
  });

  it("removes only that person, and removing someone not listed changes nothing", () => {
    const list = [invitation("a"), invitation("b")];

    expect(ids(withoutInvitee(list, "a"))).toEqual(["b"]);
    expect(ids(withoutInvitee(list, "z"))).toEqual(["a", "b"]);
  });

  it("appends a next page without repeating anyone already shown", () => {
    const list = [invitation("a"), invitation("b")];

    expect(ids(withNextPage(list, [invitation("b"), invitation("c")]))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("knows who is invited, to show 'Invited' instead of an Invite button", () => {
    const invited = invitedIds([invitation("a"), invitation("b")]);

    expect(invited.has("a")).toBe(true);
    expect(invited.has("z")).toBe(false);
  });
});

describe("invitation error messages (from the code)", () => {
  it.each([
    [403, "FORBIDDEN", INVITATION_MESSAGES.ownerOnly],
    [404, "EVENT_NOT_FOUND", INVITATION_MESSAGES.gone],
    [404, "PLAYLIST_NOT_FOUND", INVITATION_MESSAGES.gone],
    // The backend answers a plain NOT_FOUND for an unknown person on POST .../invitations.
    [404, "NOT_FOUND", INVITATION_MESSAGES.personGone],
    [404, "USER_NOT_FOUND", INVITATION_MESSAGES.personGone],
    // ...and VALIDATION_ERROR for inviting the owner, who never needs an invitation.
    [400, "VALIDATION_ERROR", INVITATION_MESSAGES.cannotInvite],
    [429, "RATE_LIMITED", MESSAGES.rateLimited],
    [0, "NETWORK_ERROR", MESSAGES.network],
    [500, "INTERNAL_ERROR", MESSAGES.server],
  ])("%i %s", (status, code, message) => {
    expect(invitationErrorMessage(new RequestError(status, code as never, "x"))).toBe(
      message,
    );
  });
});
