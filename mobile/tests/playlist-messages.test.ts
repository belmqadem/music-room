import type { Playlist } from "@music-room/shared";
import { describe, expect, it } from "vitest";
import { RequestError } from "@/api/api-error";
import { MESSAGES } from "@/auth/forms/error-messages";
import {
  addTrackErrorMessage,
  editLicenseLabel,
  PLAYLIST_MESSAGES,
  playlistErrorMessage,
  playlistTags,
  shouldReload,
} from "@/features/playlist-editor/messages";

const failure = (status: number, code: string) =>
  new RequestError(status, code as never, "x");

describe("playlist error messages (from the code)", () => {
  it.each([
    [404, "PLAYLIST_NOT_FOUND", PLAYLIST_MESSAGES.notFound],
    [404, "NOT_FOUND", PLAYLIST_MESSAGES.notFound],
    [403, "NOT_INVITED", PLAYLIST_MESSAGES.notInvited],
    [409, "ANCHOR_NOT_FOUND", PLAYLIST_MESSAGES.anchorGone],
    [404, "TRACK_NOT_FOUND", PLAYLIST_MESSAGES.entryGone],
    [409, "PLAYLIST_FULL", PLAYLIST_MESSAGES.full],
    [502, "PROVIDER_UNAVAILABLE", PLAYLIST_MESSAGES.catalogDown],
    [403, "FORBIDDEN", PLAYLIST_MESSAGES.ownerOnly],
    [429, "RATE_LIMITED", MESSAGES.rateLimited],
    [0, "NETWORK_ERROR", MESSAGES.network],
    [500, "INTERNAL_ERROR", MESSAGES.server],
  ])("%i %s", (status, code, message) => {
    expect(playlistErrorMessage(failure(status, code))).toBe(message);
  });

  it("TRACK_NOT_FOUND on an add means the catalog's track, not an entry", () => {
    expect(addTrackErrorMessage(failure(404, "TRACK_NOT_FOUND"))).toBe(
      PLAYLIST_MESSAGES.catalogMissing,
    );
    expect(addTrackErrorMessage(failure(409, "PLAYLIST_FULL"))).toBe(
      PLAYLIST_MESSAGES.full,
    );
  });
});

describe("when the list on screen is out of date", () => {
  it("re-reads it after an anchor or an entry vanished (someone else moved or removed it)", () => {
    expect(shouldReload(failure(409, "ANCHOR_NOT_FOUND"))).toBe(true);
    expect(shouldReload(failure(404, "TRACK_NOT_FOUND"))).toBe(true);
  });

  it("not for other failures", () => {
    for (const code of ["NOT_INVITED", "NETWORK_ERROR", "PLAYLIST_FULL"]) {
      expect(shouldReload(failure(400, code))).toBe(false);
    }
    expect(shouldReload(new Error("x"))).toBe(false);
  });
});

describe("how a playlist's modes read", () => {
  it("names who may edit", () => {
    expect(editLicenseLabel({ type: "everyone" })).toBe("Everyone can edit");
    expect(editLicenseLabel({ type: "invited_only" })).toBe(
      "Only invited people can edit",
    );
  });

  it("tags my own playlists and private ones", () => {
    const playlist = (
      canManage: boolean,
      visibility: "public" | "private",
    ): Playlist => ({
      id: "p1",
      name: "Mix",
      ownerId: "u1",
      visibility,
      editLicense: { type: "everyone" },
      createdAt: "2026-10-23T10:00:00Z",
      myPermissions: { canView: true, canAct: true, canManage },
    });

    expect(playlistTags(playlist(false, "public"))).toEqual([]);
    expect(playlistTags(playlist(true, "private"))).toEqual(["Yours", "Private"]);
  });
});
