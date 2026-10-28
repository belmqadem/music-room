import { usePagedList } from "@/api/use-paged-list";
import { playlistErrorMessage } from "./messages";
import { playlistApi } from "./playlist-api";

/** The playlists tab: what the server lets me see, paged (use-paged-list.ts). */
export function usePlaylists() {
  const { items, ...list } = usePagedList(
    playlistApi.list,
    playlistErrorMessage,
    "playlists",
  );
  return { playlists: items, ...list };
}
