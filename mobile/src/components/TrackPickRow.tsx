import type { Track } from "@music-room/shared";
import { Image, View } from "react-native";
import { Button } from "./Button";
import { Text } from "./Text";
import { TRACK_COVER_CLASS, TRACK_ROW_CLASS, TRACK_TEXT_CLASS } from "./track-row-styles";

export interface TrackPickRowProps {
  track: Track;
  /** The label of the action, e.g. "Add". */
  actionLabel: string;
  onPick: () => void;
  /** This track's action is on its way. */
  busy?: boolean;
  /** Another track's action is on its way. */
  disabled?: boolean;
}

/** A catalog search result with one action. Title and artist are third-party text: plain text only. */
export function TrackPickRow({
  track,
  actionLabel,
  onPick,
  busy = false,
  disabled = false,
}: TrackPickRowProps) {
  return (
    <View className={TRACK_ROW_CLASS}>
      {track.coverUrl ? (
        <Image
          source={{ uri: track.coverUrl }}
          className={TRACK_COVER_CLASS}
          accessible={false}
        />
      ) : (
        <View className={TRACK_COVER_CLASS} />
      )}
      <View className={TRACK_TEXT_CLASS}>
        <Text variant="h3" numberOfLines={1}>
          {track.title}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {track.artist}
        </Text>
      </View>
      <Button
        title={actionLabel}
        variant="secondary"
        loading={busy}
        disabled={disabled}
        onPress={onPick}
        accessibilityLabel={`${actionLabel} ${track.title}`}
      />
    </View>
  );
}
