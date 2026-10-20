import type { Track } from "@music-room/shared";
import { catalogApi } from "./catalog-api";
import { searchQueryFrom } from "./search-query";
import { useLatestSearch } from "./use-latest-search";

/** Search the music catalog as the user types. */
export function useTrackSearch() {
  return useLatestSearch<Track>(
    searchQueryFrom,
    async (query) => (await catalogApi.search(query)).items,
  );
}
