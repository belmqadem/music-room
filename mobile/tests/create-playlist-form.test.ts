import { describe, expect, it } from "vitest";
import {
  createPlaylistRequestFrom,
  EMPTY_PLAYLIST_DRAFT,
  PLAYLIST_DRAFT_MESSAGES,
  type CreatePlaylistDraft,
} from "@/features/playlist-editor/create-playlist-form";
// The backend's own schema, to prove the app builds what it accepts (tests only; never shipped).
import { createPlaylistSchema } from "../../backend/src/modules/playlist-editor/schema";

const draft = (overrides: Partial<CreatePlaylistDraft>): CreatePlaylistDraft => ({
  ...EMPTY_PLAYLIST_DRAFT,
  name: "Road trip",
  ...overrides,
});

describe("the request the form becomes", () => {
  it("a public playlist everyone can edit (the defaults)", () => {
    expect(createPlaylistRequestFrom(draft({}))).toEqual({
      ok: true,
      request: {
        name: "Road trip",
        visibility: "public",
        editLicense: { type: "everyone" },
      },
    });
  });

  it("a private playlist only invited people edit, with a trimmed name", () => {
    expect(
      createPlaylistRequestFrom(
        draft({ name: "  Study  ", visibility: "private", editMode: "invited_only" }),
      ),
    ).toEqual({
      ok: true,
      request: {
        name: "Study",
        visibility: "private",
        editLicense: { type: "invited_only" },
      },
    });
  });
});

describe("the name", () => {
  it.each([
    ["", PLAYLIST_DRAFT_MESSAGES.nameMissing],
    ["   ", PLAYLIST_DRAFT_MESSAGES.nameMissing],
    ["x".repeat(101), PLAYLIST_DRAFT_MESSAGES.nameTooLong],
  ])("%j is refused", (name, message) => {
    expect(createPlaylistRequestFrom(draft({ name }))).toEqual({
      ok: false,
      nameError: message,
    });
  });

  it("exactly 100 characters is fine", () => {
    expect(createPlaylistRequestFrom(draft({ name: "x".repeat(100) })).ok).toBe(true);
  });
});

describe("the backend accepts what the app builds (parity with playlist-editor/schema.ts)", () => {
  it.each([
    ["defaults", draft({})],
    ["private, invited only", draft({ visibility: "private", editMode: "invited_only" })],
    ["a 100-character name", draft({ name: "x".repeat(100) })],
  ])("%s", (_label, input) => {
    const result = createPlaylistRequestFrom(input);

    expect(result.ok && createPlaylistSchema.safeParse(result.request).success).toBe(
      true,
    );
  });

  it("and refuses the names the app refuses", () => {
    for (const name of ["", "   ", "x".repeat(101)]) {
      expect(createPlaylistSchema.safeParse({ name }).success).toBe(false);
    }
  });
});
