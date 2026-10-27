import type { EventQueueUpdate, EventTrack, GeoPoint } from "@music-room/shared";
import { useEffect, useRef, useState } from "react";
import { currentPosition } from "@/location/current-position";
import { connectivity, isUnreachable, offlineStore } from "@/offline";
import { live } from "@/sockets/live";
import { eventApi } from "./event-api";
import { sendWithLocationIfRequired } from "./location-required";
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
import { suggestOrVote } from "./suggest-track";

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
  const [notice, setNotice] = useState<string | null>(null);
  const [busyTrackId, setBusyTrackId] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  // Once the server asked for a position in this event, send it straight away with the next ones.
  const locationRequired = useRef(false);

  useEffect(() => {
    let active = true;
    const update = (change: (state: QueueState) => QueueState) => {
      if (active) setQueue(change);
    };

    // REST first: the queue shows even if the live connection is slow or down. Offline, the
    // queue last seen is shown instead, read only: votes and suggestions need the server.
    const cacheName = `room-queue:${eventId}`;
    const load = () =>
      eventApi.queue(eventId).then(
        (mine) => {
          update((s) => applyMyQueue(s, mine));
          void offlineStore.write(cacheName, mine);
        },
        async (error: unknown) => {
          const copy = isUnreachable(error)
            ? await offlineStore.read<EventQueueUpdate>(cacheName)
            : null;
          if (!active) return;
          if (copy) {
            update((s) => applyMyQueue(s, copy.data));
          } else setLoadError(trackVoteErrorMessage(error));
        },
      );
    void load();
    const stopOnline = connectivity.subscribe((online) => {
      if (online) void load();
    });
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
      stopOnline();
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

  /** A vote or suggestion: with the phone's position only if this event's rule needs it. */
  async function withPositionIfRequired<T>(
    send: (location?: GeoPoint) => Promise<T>,
  ): Promise<T> {
    return sendWithLocationIfRequired(send, currentPosition, {
      alreadyRequired: locationRequired.current,
      onRequired: () => {
        locationRequired.current = true;
      },
    });
  }

  async function toggleVote(track: EventTrack): Promise<void> {
    setBusyTrackId(track.id);
    setActionError(null);
    setNotice(null);
    try {
      // Withdrawing never needs a position (the contract): only a new vote may.
      const answer = track.votedByMe
        ? await eventApi.withdraw(eventId, track.id)
        : await withPositionIfRequired((location) =>
            eventApi.vote(eventId, track.id, location),
          );
      setQueue((s) => applyMyVote(s, answer));
      await refreshIfNotLive();
    } catch (error) {
      setActionError(trackVoteErrorMessage(error));
    } finally {
      setBusyTrackId(null);
    }
  }

  /**
   * Suggest a catalog track; it counts as my vote. If it is already queued (409 with that track),
   * vote for it instead, as the contract suggests. The answer is applied like any vote of mine, so
   * the track shows as voted. Returns an error message, or null when it worked.
   */
  async function suggest(providerTrackId: string): Promise<string | null> {
    setActionError(null);
    setNotice(null);
    try {
      const { track, alreadyQueued } = await withPositionIfRequired((location) =>
        suggestOrVote(eventApi, eventId, providerTrackId, location),
      );
      setQueue((s) => applyMyVote(s, track));
      if (alreadyQueued) setNotice(TRACK_VOTE_MESSAGES.alreadyQueued);
    } catch (error) {
      return trackVoteErrorMessage(error);
    }
    await refreshIfNotLive();
    return null;
  }

  /** Owner only. Sends the track this phone shows as playing, so a double tap cannot skip a song. */
  async function advance(): Promise<void> {
    setAdvancing(true);
    setActionError(null);
    setNotice(null);
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
    loadError,
    accessLost,
    actionError,
    notice,
    busyTrackId,
    advancing,
    toggleVote,
    suggest,
    advance,
  };
}
