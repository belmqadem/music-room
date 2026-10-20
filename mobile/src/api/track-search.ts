import type { Track } from "@music-room/shared";
import { searchQueryFrom } from "./search-query";

// Searching as the user types, without flooding the catalog (it is rate limited: 30 per minute per
// IP). A search starts only once typing has paused, and only the answer to the latest query is
// shown: an older, slower answer arriving last must not replace newer results.

export type SearchState =
  | { status: "idle" }
  | { status: "searching"; query: string }
  | { status: "done"; query: string; tracks: Track[] }
  | { status: "failed"; query: string; error: unknown };

export const SEARCH_DELAY_MS = 400;

export interface TrackSearchDeps {
  search(query: string): Promise<Track[]>;
  onChange(state: SearchState): void;
  delayMs?: number;
}

export function createTrackSearch(deps: TrackSearchDeps) {
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
      const tracks = await deps.search(query);
      if (ticket === latest) deps.onChange({ status: "done", query, tracks });
    } catch (error) {
      if (ticket === latest) deps.onChange({ status: "failed", query, error });
    }
  }

  return {
    /** Every change of the text field. */
    input(text: string): void {
      const query = searchQueryFrom(text);
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
