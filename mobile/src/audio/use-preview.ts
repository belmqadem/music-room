import { useFocusEffect } from "expo-router";
import { useCallback, useSyncExternalStore } from "react";
import { preview } from "./preview";
import { phaseOf, type PreviewFailure, type PreviewPhase } from "./preview-player";

/** One track's preview: what its cover shows, why it failed if it did, and the play/pause press. */
export function useTrackPreview(providerTrackId: string): {
  phase: PreviewPhase;
  failure: PreviewFailure | null;
  toggle: () => void;
} {
  const state = useSyncExternalStore(preview.subscribe, preview.getState);
  const mine = state.trackId === providerTrackId;
  return {
    phase: phaseOf(state, providerTrackId),
    failure: mine ? state.failure : null,
    toggle: () => void preview.toggle(providerTrackId),
  };
}

/** A screen with previews silences them when you leave it: no sound without its play button. */
export function useStopPreviewOnLeave(): void {
  useFocusEffect(useCallback(() => () => preview.stop(), []));
}
