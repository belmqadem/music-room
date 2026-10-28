import { auth } from "@/auth";
import { connectivity, offlineStore } from "@/offline";
import { createOutbox } from "@/offline/outbox";
import { playlistApi } from "./playlist-api";

// The app's one queue of playlist changes made offline (ADR-049): reorders and removals, sent
// through the normal API when the server is back. Adding a track needs the music catalog, so it
// stays online only.
export const playlistOutbox = createOutbox({
  store: offlineStore,
  newId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  async send(change) {
    if (change.kind === "move") {
      await playlistApi.move(change.playlistId, change.entryId, change.afterEntryId);
    } else {
      await playlistApi.remove(change.playlistId, change.entryId);
    }
  },
});

/** Sync now if signed in and the server can be reached; the outbox runs one sync at a time. */
export function syncPlaylistChanges(): void {
  if (auth.getState().status !== "signedIn" || !connectivity.isOnline()) return;
  void playlistOutbox.sync().catch((error: unknown) => {
    console.warn("Offline playlist changes could not be synced:", error);
  });
}

// Back online: send what was made offline. Signed out: the store is already cleared by the auth
// layer; forget the queue held in memory too.
connectivity.subscribe((online) => {
  if (online) syncPlaylistChanges();
});
auth.subscribe(() => {
  if (auth.getState().status === "signedOut") playlistOutbox.reset();
});
