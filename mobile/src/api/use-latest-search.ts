import { useEffect, useState } from "react";
import { createLatestSearch, type SearchState } from "./latest-search";

/** Search as the user types: waits for a pause, shows only the latest answer (latest-search.ts). */
export function useLatestSearch<T>(
  queryFrom: (text: string) => string | null,
  search: (query: string) => Promise<T[]>,
) {
  const [state, setState] = useState<SearchState<T>>({ status: "idle" });
  const [runner] = useState(() =>
    createLatestSearch<T>({ queryFrom, search, onChange: setState }),
  );
  useEffect(() => () => runner.dispose(), [runner]);
  return { state, input: runner.input, retry: runner.retry };
}
