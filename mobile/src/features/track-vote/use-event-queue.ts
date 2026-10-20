import type { EventQueueUpdate, EventTrack } from "@music-room/shared";
import { useEffect, useState, useSyncExternalStore } from "react";
import { live } from "@/sockets/live";
import type { LiveStatus } from "@/sockets/live-connection";
import { eventApi } from "./event-api";
import { currentQueueFrom, TRACK_VOTE_MESSAGES, trackVoteErrorMessage } from "./messages";
import {
  applyMyQueue,
  applyMyVote,
  applySnapshot,
  EMPTY_QUEUE,
  playingTrack,
  visibleTracks,
  type QueueState,
} from "./queue-state";

/** The live connection's state, for a "Live" / "Reconnecting" indicator. */
export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(live.onStatus, live.getStatus, live.getStatus);
}

/**
 * An event's queue on screen (ADR-034): read once over REST, then kept up to date by the live
 * connection. Every source goes through the queue state's version rule, so their order does not
 * matter. Actions wait for the server; nothing is shown before it answers.
 */
export function useEventQueue(eventId: string) {
  const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accessLost, setAccessLost] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyTrackId, setBusyTrackId] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const status = useLiveStatus();

  useEffect(() => {
    let active = true;
    const update = (change: (state: QueueState) => QueueState) => {
      if (active) setQueue(change);
    };

    // REST first: the queue shows even if the live connection is slow or down.
    eventApi.queue(eventId).then(
      (mine) => update((s) => applyMyQueue(s, mine)),
      (error: unknown) => {
        if (active) setLoadError(trackVoteErrorMessage(error));
      },
    );
    const leave = live.subscribeToEvent(eventId, {
      onState: (mine) => update((s) => applyMyQueue(s, mine)),
      onUpdate: (snapshot) => update((s) => applySnapshot(s, snapshot)),
      onRefused: (code) => {
        if (!active) return;
        // NOT_FOUND is also what a private event I may not see answers.
        if (code === "NOT_FOUND") setLoadError(TRACK_VOTE_MESSAGES.notFound);
        else console.warn(`Live updates refused for event ${eventId}:`, code);
      },
      onAccessLost: () => {
        if (active) setAccessLost(true);
      },
    });
    return () => {
      active = false;
      leave();
    };
  }, [eventId]);

  /** Without live updates, counts and order would stay old after an action: read them again. */
  async function refreshIfNotLive(): Promise<void> {
    if (live.getStatus() === "live") return;
    try {
      const mine: EventQueueUpdate = await eventApi.queue(eventId);
      setQueue((s) => applyMyQueue(s, mine));
    } catch (error) {
      console.warn("Could not reload the queue:", error);
    }
  }

  async function toggleVote(track: EventTrack): Promise<void> {
    setBusyTrackId(track.id);
    setActionError(null);
    try {
      const answer = track.votedByMe
        ? await eventApi.withdraw(eventId, track.id)
        : await eventApi.vote(eventId, track.id);
      setQueue((s) => applyMyVote(s, answer));
      await refreshIfNotLive();
    } catch (error) {
      setActionError(trackVoteErrorMessage(error));
    } finally {
      setBusyTrackId(null);
    }
  }

  /** Owner only. Sends the track this phone shows as playing, so a double tap cannot skip a song. */
  async function advance(): Promise<void> {
    setAdvancing(true);
    setActionError(null);
    try {
      const next = await eventApi.advance(eventId, playingTrack(queue)?.id ?? null);
      setQueue((s) => applyMyQueue(s, next));
    } catch (error) {
      const current = currentQueueFrom(error);
      if (current) setQueue((s) => applyMyQueue(s, current));
      setActionError(trackVoteErrorMessage(error));
    } finally {
      setAdvancing(false);
    }
  }

  return {
    loaded: queue.version >= 0,
    tracks: visibleTracks(queue),
    playing: playingTrack(queue),
    status,
    loadError,
    accessLost,
    actionError,
    busyTrackId,
    advancing,
    toggleVote,
    advance,
  };
}
