import type { Page } from "@music-room/shared";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { connectivity, isUnreachable, offlineStore } from "@/offline";

/**
 * A paged list from the backend (events, playlists, friends): the first page (again on each return
 * to the screen, so something created meanwhile shows up), pull to refresh, and the next pages as
 * the list scrolls. Items are never shown twice: one created between two pages can shift the list.
 *
 * With `cacheName` (offline mode, ADR-049) the first page is kept on the phone; when the server
 * cannot be reached that copy is shown instead, and it is replaced by the
 * server's answer as soon as the server is back.
 */
export function usePagedList<T extends { id: string }>(
  fetchPage: (cursor?: string) => Promise<Page<T>>,
  errorMessage: (error: unknown) => string,
  cacheName?: string,
) {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A page request is in flight: a second scroll to the end must not ask for the same page twice.
  const loadingMore = useRef(false);

  const showFirstPage = useCallback(
    (page: Page<T>) => {
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setError(null);
      if (cacheName) void offlineStore.write(cacheName, page.items);
    },
    [cacheName],
  );

  /** The server could not answer: show the offline copy if there is one, else the error. */
  const showFailure = useCallback(
    async (failure: unknown) => {
      if (cacheName && isUnreachable(failure)) {
        const copy = await offlineStore.read<T[]>(cacheName);
        if (copy) {
          setItems(copy.data);
          setNextCursor(null); // more pages need the server
          setError(null);
          return;
        }
      }
      setError(errorMessage(failure));
    },
    [cacheName, errorMessage],
  );

  const loadFirst = useCallback(
    () => fetchPage().then(showFirstPage, showFailure),
    [fetchPage, showFirstPage, showFailure],
  );

  // fetchPage and errorMessage are module-level functions of each screen, so this runs on focus only.
  useFocusEffect(
    useCallback(() => {
      void loadFirst().finally(() => setLoading(false));
    }, [loadFirst]),
  );

  // Back online: the copy on screen is replaced by the server's list.
  useEffect(
    () =>
      connectivity.subscribe((online) => {
        if (online) void loadFirst();
      }),
    [loadFirst],
  );

  async function refresh(): Promise<void> {
    setRefreshing(true);
    await loadFirst();
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
      setError(errorMessage(failure));
    } finally {
      loadingMore.current = false;
    }
  }

  /** Another page exists: for a "Show more" button where the list is not a FlatList. */
  const hasMore = nextCursor !== null;
  return { items, loading, refreshing, error, refresh, loadMore, hasMore };
}
