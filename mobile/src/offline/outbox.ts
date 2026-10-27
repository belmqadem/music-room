import type { PlaylistEntry } from "@music-room/shared";
import { isRequestError } from "@/api/api-error";
import type { OfflineStore } from "./offline-store";

// Playlist changes made offline (ADR-049): reorders and removals, shown at once on the phone's copy
// and kept in order until the server can be reached. Then each is sent through the normal API, and
// the server decides: an offline change is a request, not a fact. The playlist is read again from
// the server afterwards, so the phone never keeps its own version of it.

export type PendingChange = {
  opId: string;
  playlistId: string;
  entryId: string;
  /** For the summary: "someone removed Robot Rock". */
  trackTitle: string;
  queuedAt: string;
} & ({ kind: "move"; afterEntryId: string | null } | { kind: "remove" });

/** Why a change could not be applied; each has its own sentence in the summary. */
export type DropReason =
  | "trackGone" // someone removed that track meanwhile
  | "anchorGone" // the track it was to follow was removed meanwhile
  | "noAccess" // the playlist is gone, private now, or you may not edit it anymore
  | "premium" // editing playlists needs Premium (ADR-048), e.g. after a downgrade
  | "refused"; // any other refusal

export type Outcome =
  | { kind: "applied" }
  | { kind: "dropped"; reason: DropReason }
  /** Not decided: offline again, server trouble, rate limited. Kept, tried again later. */
  | { kind: "retry" };

/** What the server's answer to one change means. */
export function outcomeOf(change: PendingChange, error: unknown | null): Outcome {
  if (error === null) return { kind: "applied" };
  if (!isRequestError(error)) return { kind: "retry" };
  switch (error.code) {
    case "NETWORK_ERROR":
    case "RATE_LIMITED":
      return { kind: "retry" };
    case "TRACK_NOT_FOUND":
      // The entry is gone: a removal already happened, a move no longer can.
      return change.kind === "remove"
        ? { kind: "applied" }
        : { kind: "dropped", reason: "trackGone" };
    case "ANCHOR_NOT_FOUND":
      return { kind: "dropped", reason: "anchorGone" };
    case "PREMIUM_REQUIRED":
      return { kind: "dropped", reason: "premium" };
    case "PLAYLIST_NOT_FOUND":
    case "NOT_FOUND":
    case "NOT_INVITED":
    case "FORBIDDEN":
      return { kind: "dropped", reason: "noAccess" };
    default:
      // A session that ended is handled by the auth layer; server trouble is temporary.
      return error.status >= 500 || error.status === 401
        ? { kind: "retry" }
        : { kind: "dropped", reason: "refused" };
  }
}

/** The phone's copy of a playlist with its pending changes applied, in order. */
export function applyPending(
  entries: readonly PlaylistEntry[],
  changes: readonly PendingChange[],
): PlaylistEntry[] {
  let list = [...entries];
  for (const change of changes) {
    const index = list.findIndex((entry) => entry.id === change.entryId);
    if (index < 0) continue; // already gone on this copy
    const [entry] = list.splice(index, 1);
    if (change.kind === "remove" || !entry) continue;
    if (change.afterEntryId === null) {
      list = [entry, ...list];
      continue;
    }
    const anchor = list.findIndex((other) => other.id === change.afterEntryId);
    // Its anchor is gone from this copy too: leave the entry where it was.
    list.splice(anchor < 0 ? index : anchor + 1, 0, entry);
  }
  return list;
}

export interface SyncSummary {
  synced: number;
  dropped: { reason: DropReason; trackTitle: string }[];
}

const OUTBOX = "outbox";

export function createOutbox(deps: {
  store: OfflineStore;
  /** Sends one change through the API; throws the API's error. */
  send: (change: PendingChange) => Promise<void>;
  newId: () => string;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  let changes: PendingChange[] | null = null; // loaded from the store on first use
  let syncing: Promise<SyncSummary> | null = null;
  let lastSummary: SyncSummary | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  async function load(): Promise<PendingChange[]> {
    changes ??= (await deps.store.read<PendingChange[]>(OUTBOX))?.data ?? [];
    return changes;
  }
  async function save(): Promise<void> {
    await deps.store.write(OUTBOX, changes ?? []);
    notify();
  }

  async function runSync(): Promise<SyncSummary> {
    const summary: SyncSummary = { synced: 0, dropped: [] };
    const queue = await load();
    // One at a time, in the order they were made; a change made during the sync joins the end.
    while (queue.length > 0) {
      const change = queue[0]!;
      let error: unknown | null = null;
      try {
        await deps.send(change);
      } catch (failure) {
        error = failure;
      }
      const outcome = outcomeOf(change, error);
      if (outcome.kind === "retry") break; // keep it and everything after it, in order
      queue.shift();
      if (outcome.kind === "applied") summary.synced += 1;
      else
        summary.dropped.push({ reason: outcome.reason, trackTitle: change.trackTitle });
      await save();
    }
    if (summary.synced > 0 || summary.dropped.length > 0) {
      lastSummary = summary;
      notify();
    }
    return summary;
  }

  return {
    async pendingFor(playlistId: string): Promise<PendingChange[]> {
      return (await load()).filter((change) => change.playlistId === playlistId);
    },
    async count(): Promise<number> {
      return (await load()).length;
    },
    async enqueue(
      change:
        | Omit<Extract<PendingChange, { kind: "move" }>, "opId" | "queuedAt">
        | Omit<Extract<PendingChange, { kind: "remove" }>, "opId" | "queuedAt">,
    ): Promise<void> {
      (await load()).push({
        ...change,
        opId: deps.newId(),
        queuedAt: now().toISOString(),
      } as PendingChange);
      await save();
    },
    /** One sync at a time: a second call while one runs gets the same result. */
    sync(): Promise<SyncSummary> {
      syncing ??= runSync().finally(() => {
        syncing = null;
      });
      return syncing;
    },
    /** The last sync that did something, shown until dismissed (any screen may show it). */
    summary(): SyncSummary | null {
      return lastSummary;
    },
    dismissSummary(): void {
      lastSummary = null;
      notify();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Sign-out: forget everything (the store itself is cleared by the caller). */
    reset(): void {
      changes = [];
      lastSummary = null;
      notify();
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
