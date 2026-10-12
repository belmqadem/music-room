import { describe, expect, it } from "vitest";
import {
  requireAct,
  requireManage,
  requireView,
  toHttpError,
} from "../../src/modules/access/guards.js";
import { HttpError } from "../../src/http-error.js";
import type {
  AccessResource,
  AccessSubject,
  Refusal,
} from "../../src/modules/access/rules.js";

const publicEvent: AccessResource = {
  ownerId: "owner",
  visibility: "public",
  license: { type: "invited_only" },
};
const privateEvent: AccessResource = { ...publicEvent, visibility: "private" };
const stranger: AccessSubject = { userId: "other", isInvited: false };
const owner: AccessSubject = { userId: "owner", isInvited: false };
const context = { now: new Date() };

describe("toHttpError", () => {
  it.each([
    ["NOT_FOUND", 404, "EVENT_NOT_FOUND"],
    ["FORBIDDEN", 403, "FORBIDDEN"],
    ["NOT_INVITED", 403, "NOT_INVITED"],
    ["LOCATION_REQUIRED", 400, "LOCATION_REQUIRED"],
    ["OUTSIDE_VOTING_AREA", 403, "OUTSIDE_VOTING_AREA"],
    ["OUTSIDE_VOTING_TIME", 403, "OUTSIDE_VOTING_TIME"],
  ] satisfies [Refusal, number, string][])(
    "maps %s to HTTP %i %s",
    (refusal, status, code) => {
      const error = toHttpError("event", refusal);

      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ status, code });
    },
  );

  it("uses the playlist wording for a missing playlist", () => {
    expect(toHttpError("playlist", "NOT_FOUND")).toMatchObject({
      status: 404,
      code: "PLAYLIST_NOT_FOUND",
    });
  });

  it("answers an unseen private resource exactly like a missing one", () => {
    const hidden = (() => {
      try {
        requireView("event", privateEvent, stranger);
      } catch (error) {
        return error as HttpError;
      }
      return undefined;
    })();

    expect(hidden).toMatchObject({
      status: toHttpError("event", "NOT_FOUND").status,
      code: "EVENT_NOT_FOUND",
    });
    expect(hidden?.message).toBe(toHttpError("event", "NOT_FOUND").message);
  });
});

describe("requireView", () => {
  it("passes for a visible resource and throws 404 for a hidden one", () => {
    expect(() => requireView("event", publicEvent, stranger)).not.toThrow();
    expect(() => requireView("event", privateEvent, stranger)).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
  });
});

describe("requireAct", () => {
  it("throws 403 NOT_INVITED for a visible resource the user may not act on", () => {
    expect(() => requireAct("event", publicEvent, stranger, context)).toThrowError(
      expect.objectContaining({ status: 403, code: "NOT_INVITED" }),
    );
  });

  it("throws 404 rather than 403 when the user may not even see it", () => {
    expect(() => requireAct("event", privateEvent, stranger, context)).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
  });

  it("passes for the owner", () => {
    expect(() => requireAct("event", privateEvent, owner, context)).not.toThrow();
  });
});

describe("requireManage", () => {
  it("passes only for the owner", () => {
    expect(() => requireManage("playlist", publicEvent, owner)).not.toThrow();
    expect(() => requireManage("playlist", publicEvent, stranger)).toThrowError(
      expect.objectContaining({ status: 403, code: "FORBIDDEN" }),
    );
    expect(() => requireManage("playlist", privateEvent, stranger)).toThrowError(
      expect.objectContaining({ status: 404, code: "PLAYLIST_NOT_FOUND" }),
    );
  });
});
