// Searching as the user types (the catalog, people to invite), without flooding the backend (both
// searches are rate limited: 30 per minute per IP). A search starts only once typing has paused,
// and only the answer to the latest query is shown: an older, slower answer arriving last must not
// replace newer results.

export type SearchState<T> =
  | { status: "idle" }
  | { status: "searching"; query: string }
  | { status: "done"; query: string; results: T[] }
  | { status: "failed"; query: string; error: unknown };

export const SEARCH_DELAY_MS = 400;

export interface LatestSearchDeps<T> {
  /** The query to send for this text, or null when there is nothing to search yet. */
  queryFrom(text: string): string | null;
  search(query: string): Promise<T[]>;
  onChange(state: SearchState<T>): void;
  delayMs?: number;
}

export function createLatestSearch<T>(deps: LatestSearchDeps<T>) {
  const delayMs = deps.delayMs ?? SEARCH_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest = 0; // bumped by every new input, so answers to older queries are dropped
  let lastQuery: string | null = null;

  function stopWaiting(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  async function run(query: string, ticket: number): Promise<void> {
    deps.onChange({ status: "searching", query });
    try {
      const results = await deps.search(query);
      if (ticket === latest) deps.onChange({ status: "done", query, results });
    } catch (error) {
      if (ticket === latest) deps.onChange({ status: "failed", query, error });
    }
  }

  return {
    /** Every change of the text field. */
    input(text: string): void {
      const query = deps.queryFrom(text);
      if (query === lastQuery) return; // only spaces changed: same search
      lastQuery = query;
      stopWaiting();
      const ticket = ++latest;
      if (query === null) {
        deps.onChange({ status: "idle" });
        return;
      }
      timer = setTimeout(() => void run(query, ticket), delayMs);
    },
    /** Search the current text again now (after a failure). */
    retry(): void {
      if (lastQuery === null) return;
      stopWaiting();
      void run(lastQuery, ++latest);
    },
    /** The screen is closing: nothing more is reported. */
    dispose(): void {
      stopWaiting();
      latest += 1;
    },
  };
}
