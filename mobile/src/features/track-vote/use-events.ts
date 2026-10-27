import { usePagedList } from "@/api/use-paged-list";
import { eventApi } from "./event-api";
import { trackVoteErrorMessage } from "./messages";

/** The events tab: what the server lets me see, paged (use-paged-list.ts). */
export function useEvents() {
  const { items, ...list } = usePagedList(eventApi.list, trackVoteErrorMessage, "rooms");
  return { events: items, ...list };
}
