import type { EventQueueUpdate } from "@music-room/shared";
import type { PreviewPlayer } from "@/audio/preview-player";

/**
 * After the owner's Start playing or Next track (ADR-053): their phone plays the sample of the
 * track the server now says is playing, or falls silent when the queue ran out. Only the owner's
 * phone: everyone else still presses play themselves.
 */
export function followPlayingTrack(
  update: EventQueueUpdate,
  player: Pick<PreviewPlayer, "play" | "stop">,
): void {
  const playing = update.tracks.find((entry) => entry.status === "playing");
  if (playing) void player.play(playing.track.providerTrackId);
  else player.stop();
}
