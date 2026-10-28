import type { Track } from "@music-room/shared";
import { ActivityIndicator, Image, Pressable, View } from "react-native";
import { useTrackPreview } from "@/audio/use-preview";
import { copy } from "@/copy";
import { colors } from "@/theme/tokens.generated";
import { Icon } from "./Icon";
import { Text } from "./Text";
import { TRACK_COVER_CLASS, TRACK_COVER_OVERLAY_CLASS } from "./track-row-styles";

/**
 * A track's cover, which is also its preview button (ADR-053): press to hear 30 seconds on this
 * phone, press again to pause. Only one track plays at a time.
 */
export function TrackCover({ track }: { track: Track }) {
  const { phase, toggle } = useTrackPreview(track.providerTrackId);
  const playing = phase === "playing";
  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={
        playing ? copy.preview.pause(track.title) : copy.preview.play(track.title)
      }
      accessibilityState={{ busy: phase === "loading" }}
      className="active:opacity-70"
    >
      {track.coverUrl ? (
        <Image
          source={{ uri: track.coverUrl }}
          className={TRACK_COVER_CLASS}
          accessible={false}
        />
      ) : (
        <View className={TRACK_COVER_CLASS} />
      )}
      <View className={TRACK_COVER_OVERLAY_CLASS}>
        {phase === "loading" ? (
          <ActivityIndicator color={colors.contentPrimary} />
        ) : (
          <Icon name={playing ? "pause" : "play"} tone="primary" />
        )}
      </View>
    </Pressable>
  );
}

/** Why this track's preview didn't play, under its artist; nothing otherwise. */
export function TrackPreviewProblem({ track }: { track: Track }) {
  const { failure } = useTrackPreview(track.providerTrackId);
  if (!failure) return null;
  return (
    <Text variant="caption" tone="error" accessibilityLiveRegion="polite">
      {copy.preview.errors[failure]}
    </Text>
  );
}
