import type { PlaylistSnapshot } from "@music-room/shared";
import { useEffect, useState } from "react";
import { live } from "@/sockets/live";
import {
  addTrackErrorMessage,
  PLAYLIST_MESSAGES,
  playlistErrorMessage,
  shouldReload,
} from "./messages";
import { playlistApi } from "./playlist-api";
import {
  applyPlaylist,
  EMPTY_PLAYLIST,
  moveDownAnchor,
  moveUpAnchor,
  type PlaylistState,
} from "./playlist-state";

/**
 * A playlist on screen (ADR-036): read once over REST, then kept up to date by the live connection.
 * Every edit answers with the whole new list; it goes through the same version rule as the live
 * updates, so their order does not matter. Nothing is shown before the server has it.
 */
export function usePlaylist(playlistId: string) {
  const [state, setState] = useState<PlaylistState>(EMPTY_PLAYLIST);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accessLost, setAccessLost] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const apply = (snapshot: PlaylistSnapshot) => {
      if (active) setState((s) => applyPlaylist(s, snapshot));
    };
    playlistApi.tracks(playlistId).then(apply, (error: unknown) => {
      if (active) setLoadError(playlistErrorMessage(error));
    });
    const leave = live.subscribeToPlaylist(playlistId, {
      onState: apply,
      onUpdate: apply,
      onRefused: (code) => {
        if (!active) return;
        // NOT_FOUND is also what a private playlist I may not see answers.
        if (code === "NOT_FOUND") setLoadError(PLAYLIST_MESSAGES.notFound);
        else console.warn(`Live updates refused for playlist ${playlistId}:`, code);
      },
      onAccessLost: () => {
        if (active) setAccessLost(true);
      },
    });
    return () => {
      active = false;
      leave();
    };
  }, [playlistId]);

  /** The list on screen is out of date (someone moved or removed an entry): read it again. */
  async function reload(): Promise<void> {
    try {
      const fresh = await playlistApi.tracks(playlistId);
      setState((s) => applyPlaylist(s, fresh));
    } catch (error) {
      console.warn("Could not reload the playlist:", error);
    }
  }

  /** One edit: show its answer, or say why not (and re-read the list if it was out of date). */
  async function edit(
    entryId: string | null,
    send: () => Promise<PlaylistSnapshot>,
    {
      message = playlistErrorMessage,
      // An add is made from the search sheet, which shows its own error: not on the screen too.
      onScreen = true,
    }: { message?: (error: unknown) => string; onScreen?: boolean } = {},
  ): Promise<string | null> {
    setBusyEntryId(entryId);
    setActionError(null);
    try {
      const snapshot = await send();
      setState((s) => applyPlaylist(s, snapshot));
      return null;
    } catch (error) {
      const text = message(error);
      if (onScreen) setActionError(text);
      if (shouldReload(error)) await reload();
      return text;
    } finally {
      setBusyEntryId(null);
    }
  }

  function moveUp(index: number): void {
    const anchor = moveUpAnchor(state.entries, index);
    const entry = state.entries[index];
    if (anchor === undefined || !entry) return;
    void edit(entry.id, () => playlistApi.move(playlistId, entry.id, anchor));
  }

  function moveDown(index: number): void {
    const anchor = moveDownAnchor(state.entries, index);
    const entry = state.entries[index];
    if (anchor === undefined || !entry) return;
    void edit(entry.id, () => playlistApi.move(playlistId, entry.id, anchor));
  }

  return {
    loaded: state.version >= 0,
    entries: state.entries,
    loadError,
    accessLost,
    actionError,
    busyEntryId,
    /** For the search sheet: an error message, or null when the track was added. */
    add: (providerTrackId: string) =>
      edit(null, () => playlistApi.add(playlistId, providerTrackId), {
        message: addTrackErrorMessage,
        onScreen: false,
      }),
    remove: (entryId: string) =>
      void edit(entryId, () => playlistApi.remove(playlistId, entryId)),
    moveUp,
    moveDown,
    canMoveUp: (index: number) => moveUpAnchor(state.entries, index) !== undefined,
    canMoveDown: (index: number) => moveDownAnchor(state.entries, index) !== undefined,
  };
}
