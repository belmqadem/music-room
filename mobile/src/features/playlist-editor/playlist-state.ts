import type { PlaylistEntry, PlaylistSnapshot } from "@music-room/shared";

// A playlist as this phone shows it (ADR-036). The server orders and numbers every edit; the app
// only applies the newest list it has seen. Every answer and every live update is the full list
// plus a `version`, so a newer one simply replaces the old one, and an older or equal one is
// ignored (it can arrive late). Edits are sent as intent ("after this entry"), never as an index.

export interface PlaylistState {
  /** -1 until the first list arrives. */
  version: number;
  entries: PlaylistEntry[];
}

export const EMPTY_PLAYLIST: PlaylistState = { version: -1, entries: [] };

export function applyPlaylist(
  state: PlaylistState,
  snapshot: PlaylistSnapshot,
): PlaylistState {
  if (snapshot.version <= state.version) return state;
  return { version: snapshot.version, entries: snapshot.tracks };
}

/**
 * The anchor for moving the entry at `index` one place up: the entry two above it, or null for the
 * very start. Undefined when it cannot move up (already first).
 */
export function moveUpAnchor(
  entries: PlaylistEntry[],
  index: number,
): string | null | undefined {
  if (index <= 0 || index >= entries.length) return undefined;
  return index >= 2 ? entries[index - 2]!.id : null;
}

/** The anchor for moving one place down: the entry just below it. Undefined when already last. */
export function moveDownAnchor(
  entries: PlaylistEntry[],
  index: number,
): string | undefined {
  if (index < 0 || index >= entries.length - 1) return undefined;
  return entries[index + 1]!.id;
}
