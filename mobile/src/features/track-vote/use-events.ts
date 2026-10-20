import type { MusicEvent, Page } from "@music-room/shared";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { eventApi } from "./event-api";
import { trackVoteErrorMessage } from "./messages";

/** The events tab: the first page (again on each return), pull to refresh, and the next pages as the list scrolls. */
export function useEvents() {
  const [events, setEvents] = useState<MusicEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A page request is in flight: a second scroll to the end must not ask for the same page twice.
  const loadingMore = useRef(false);

  function showFirstPage(page: Page<MusicEvent>): void {
    setEvents(page.items);
    setNextCursor(page.nextCursor);
    setError(null);
  }
  function showError(failure: unknown): void {
    setError(trackVoteErrorMessage(failure));
  }

  // On every return to the tab, not only the first time: an event created meanwhile shows up.
  useFocusEffect(
    useCallback(() => {
      eventApi
        .list()
        .then(showFirstPage, showError)
        .finally(() => setLoading(false));
    }, []),
  );

  async function refresh(): Promise<void> {
    setRefreshing(true);
    await eventApi.list().then(showFirstPage, showError);
    setRefreshing(false);
  }

  async function loadMore(): Promise<void> {
    if (!nextCursor || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const page = await eventApi.list(nextCursor);
      // An event created between two pages can shift the list: never show one twice.
      setEvents((shown) => {
        const seen = new Set(shown.map((e) => e.id));
        return [...shown, ...page.items.filter((e) => !seen.has(e.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (failure) {
      setError(trackVoteErrorMessage(failure));
    } finally {
      loadingMore.current = false;
    }
  }

  return { events, loading, refreshing, error, refresh, loadMore };
}
