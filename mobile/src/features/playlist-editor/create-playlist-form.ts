import type { CreatePlaylistRequest, EditLicense, Visibility } from "@music-room/shared";

// The create-playlist form (docs/api-contract.md, "Playlists"): name, who can see it, who may edit.
// The checks mirror the backend's (playlist-editor/schema.ts); a test proves both agree.

export const NAME_MAX_LENGTH = 100;

export interface CreatePlaylistDraft {
  name: string;
  visibility: Visibility;
  editMode: EditLicense["type"];
}

export const EMPTY_PLAYLIST_DRAFT: CreatePlaylistDraft = {
  name: "",
  visibility: "public",
  editMode: "everyone",
};

export const PLAYLIST_DRAFT_MESSAGES = {
  nameMissing: "Give the playlist a name.",
  nameTooLong: `Keep the name under ${NAME_MAX_LENGTH + 1} characters.`,
} as const;

export type PlaylistDraftResult =
  { ok: true; request: CreatePlaylistRequest } | { ok: false; nameError: string };

export function createPlaylistRequestFrom(
  draft: CreatePlaylistDraft,
): PlaylistDraftResult {
  const name = draft.name.trim();
  if (name.length === 0)
    return { ok: false, nameError: PLAYLIST_DRAFT_MESSAGES.nameMissing };
  if (name.length > NAME_MAX_LENGTH) {
    return { ok: false, nameError: PLAYLIST_DRAFT_MESSAGES.nameTooLong };
  }
  return {
    ok: true,
    request: {
      name,
      visibility: draft.visibility,
      editLicense: { type: draft.editMode },
    },
  };
}
