import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { catalogApi } from "@/api/catalog-api";
import { auth } from "@/auth";
import { classifyPreviewError } from "./preview-errors";
import { createPreviewPlayer, type AudioOutput } from "./preview-player";

// The app's preview player (ADR-053): `import { preview } from "@/audio/preview"`. One expo-audio
// player for the whole app, made at the first play, so only one sample ever sounds.

let player: AudioPlayer | null = null;

function audioPlayer(): AudioPlayer {
  if (player) return player;
  // A sample is music the person asked for: it plays even with the iPhone's silent switch on.
  setAudioModeAsync({ playsInSilentMode: true }).catch((error: unknown) =>
    console.warn("Previews: couldn't set the audio mode:", error),
  );
  player = createAudioPlayer(null);
  return player;
}

const statusListeners = new Set<Parameters<AudioOutput["onStatus"]>[0]>();

const output: AudioOutput = {
  load(url) {
    const created = player === null;
    const current = audioPlayer();
    if (created)
      current.addListener("playbackStatusUpdate", (status) =>
        statusListeners.forEach((listener) =>
          listener({
            playing: status.playing,
            didJustFinish: status.didJustFinish,
            error: status.error,
          }),
        ),
      );
    current.replace({ uri: url });
  },
  play: () => player?.play(),
  pause: () => player?.pause(),
  seekTo: (seconds) => player?.seekTo(seconds) ?? Promise.resolve(),
  onStatus(listener) {
    statusListeners.add(listener);
    return () => statusListeners.delete(listener);
  },
};

export const preview = createPreviewPlayer({
  fetchPreviewUrl: async (id) => (await catalogApi.preview(id)).url,
  output,
  classify: classifyPreviewError,
});

// Signing out silences whatever was playing.
auth.subscribe(() => {
  if (auth.getState().status === "signedOut") preview.stop();
});
