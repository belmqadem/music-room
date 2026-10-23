import type { Page } from "@music-room/shared";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";

/**
 * A paged list from the backend (events, playlists): the first page (again on each return to the
 * screen, so something created meanwhile shows up), pull to refresh, and the next pages as the
 * list scrolls. Items are never shown twice: one created between two pages can shift the list.
 */
export function usePagedList<T extends { id: string }>(
  fetchPage: (cursor?: string) => Promise<Page<T>>,
  errorMessage: (error: unknown) => string,
) {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A page request is in flight: a second scroll to the end must not ask for the same page twice.
  const loadingMore = useRef(false);

  function showFirstPage(page: Page<T>): void {
    setItems(page.items);
    setNextCursor(page.nextCursor);
    setError(null);
  }
  function showError(failure: unknown): void {
    setError(errorMessage(failure));
  }

  // fetchPage and errorMessage are module-level functions of each screen, so this runs on focus only.
  useFocusEffect(
    useCallback(() => {
      fetchPage()
        .then(
          (page) => {
            setItems(page.items);
            setNextCursor(page.nextCursor);
            setError(null);
          },
          (failure: unknown) => setError(errorMessage(failure)),
        )
        .finally(() => setLoading(false));
    }, [fetchPage, errorMessage]),
  );

  async function refresh(): Promise<void> {
    setRefreshing(true);
    await fetchPage().then(showFirstPage, showError);
    setRefreshing(false);
  }

  async function loadMore(): Promise<void> {
    if (!nextCursor || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const page = await fetchPage(nextCursor);
      setItems((shown) => {
        const seen = new Set(shown.map((item) => item.id));
        return [...shown, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (failure) {
      showError(failure);
    } finally {
      loadingMore.current = false;
    }
  }

  return { items, loading, refreshing, error, refresh, loadMore };
}
