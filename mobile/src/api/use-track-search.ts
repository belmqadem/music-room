import { useEffect, useState } from "react";
import { catalogApi } from "./catalog-api";
import { createTrackSearch, type SearchState } from "./track-search";

/** Search the catalog as the user types (waits for a pause; only the latest answer is shown). */
export function useTrackSearch() {
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [search] = useState(() =>
    createTrackSearch({
      search: async (query) => (await catalogApi.search(query)).items,
      onChange: setState,
    }),
  );
  useEffect(() => () => search.dispose(), [search]);
  return { state, input: search.input, retry: search.retry };
}
