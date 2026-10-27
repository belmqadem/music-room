import type { PlaylistSnapshot } from "@music-room/shared";
import { useEffect, useMemo, useState } from "react";
import { connectivity, isUnreachable, offlineStore } from "@/offline";
import { applyPending, type PendingChange } from "@/offline/outbox";
import { live } from "@/sockets/live";
import {
  addTrackErrorMessage,
  PLAYLIST_MESSAGES,
  playlistErrorMessage,
  shouldReload,
} from "./messages";
import { playlistOutbox, syncPlaylistChanges } from "./offline-edits";
import { playlistApi } from "./playlist-api";
import {
  applyPlaylist,
  EMPTY_PLAYLIST,
  moveDownAnchor,
  moveUpAnchor,
  type PlaylistState,
} from "./playlist-state";

/** Thrown inside an edit that was queued for later instead of sent; not an error to show. */
class QueuedOffline extends Error {}
const QUEUED = "queued";

/**
 * A playlist on screen (ADR-036): read once over REST, then kept up to date by the live connection.
 * Every edit answers with the whole new list; it goes through the same version rule as the live
 * updates, so their order does not matter. Nothing is shown before the server has it.
 *
 * Offline (ADR-049): the last list seen is kept on the phone and shown with when it was saved.
 * Reorders and removals made offline are shown at once and queued; once synced, the list is read
 * again from the server, which may not have taken them all.
 */
export function usePlaylist(playlistId: string) {
  const [state, setState] = useState<PlaylistState>(EMPTY_PLAYLIST);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accessLost, setAccessLost] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingChange[]>([]);
  const cacheName = `playlist-tracks:${playlistId}`;

  useEffect(() => {
    let active = true;
    const apply = (snapshot: PlaylistSnapshot) => {
      if (!active) return;
      setState((s) => applyPlaylist(s, snapshot));
      setCachedAt(null);
      void offlineStore.write(cacheName, snapshot);
    };
    const load = () =>
      playlistApi.tracks(playlistId).then(apply, async (error: unknown) => {
        const copy = isUnreachable(error)
          ? await offlineStore.read<PlaylistSnapshot>(cacheName)
          : null;
        if (!active) return;
        if (copy) {
          setState((s) => applyPlaylist(s, copy.data));
          setCachedAt(copy.savedAt);
        } else setLoadError(playlistErrorMessage(error));
      });
    void load();
    // The changes made offline for this playlist, kept up to date as they are queued or synced.
    // After a sync the server's list is read again: it has the last word on each change.
    const showPending = () =>
      void playlistOutbox.pendingFor(playlistId).then((changes) => {
        if (active) setPending(changes);
      });
    showPending();
    const stopPending = playlistOutbox.subscribe(() => {
      showPending();
      if (connectivity.isOnline()) void load();
    });
    const stopOnline = connectivity.subscribe((online) => {
      if (online) void load();
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
      stopPending();
      stopOnline();
    };
  }, [playlistId, cacheName]);

  // What is shown: the server's (or the saved) list with the offline changes applied on top.
  const entries = useMemo(
    () => applyPending(state.entries, pending),
    [state.entries, pending],
  );

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
      const text = error instanceof QueuedOffline ? QUEUED : message(error);
      if (onScreen) setActionError(text);
      if (shouldReload(error)) await reload();
      return text;
    } finally {
      setBusyEntryId(null);
    }
  }

  /**
   * A reorder or removal: sent now when the server can be reached; otherwise (or if it turns out
   * not to be) queued for later and shown at once. Anchors are taken from the list as shown.
   */
  async function change(
    entryId: string,
    queued: { kind: "move"; afterEntryId: string | null } | { kind: "remove" },
    send: () => Promise<PlaylistSnapshot>,
  ): Promise<void> {
    const trackTitle = entries.find((e) => e.id === entryId)?.track.title ?? "";
    const queue = () =>
      playlistOutbox.enqueue({ playlistId, entryId, trackTitle, ...queued });
    if (!connectivity.isOnline()) return queue();
    const text = await edit(entryId, async () => {
      try {
        return await send();
      } catch (error) {
        if (isUnreachable(error)) {
          await queue();
          throw new QueuedOffline();
        }
        throw error;
      }
    });
    // Queued instead of refused: no error on screen.
    if (text === QUEUED) setActionError(null);
  }

  function moveUp(index: number): void {
    const anchor = moveUpAnchor(entries, index);
    const entry = entries[index];
    if (anchor === undefined || !entry) return;
    void change(entry.id, { kind: "move", afterEntryId: anchor }, () =>
      playlistApi.move(playlistId, entry.id, anchor),
    );
  }

  function moveDown(index: number): void {
    const anchor = moveDownAnchor(entries, index);
    const entry = entries[index];
    if (anchor === undefined || !entry) return;
    void change(entry.id, { kind: "move", afterEntryId: anchor }, () =>
      playlistApi.move(playlistId, entry.id, anchor),
    );
  }

  return {
    loaded: state.version >= 0,
    entries,
    /** When the saved list on screen was kept; null when it is the server's. */
    cachedAt,
    /** Changes made offline for this playlist, not synced yet. */
    pendingCount: pending.length,
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
      void change(entryId, { kind: "remove" }, () =>
        playlistApi.remove(playlistId, entryId),
      ),
    moveUp,
    moveDown,
    canMoveUp: (index: number) => moveUpAnchor(entries, index) !== undefined,
    canMoveDown: (index: number) => moveDownAnchor(entries, index) !== undefined,
    /** Send the queue now (used when the screen opens online). */
    sync: syncPlaylistChanges,
  };
}
