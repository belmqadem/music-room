import type { Track } from "@music-room/shared";
import { ActivityIndicator, Pressable, View } from "react-native";
import { colors } from "@/theme/tokens.generated";
import { Text } from "./Text";
import { TrackCover, TrackPreviewProblem } from "./TrackCover";
import { iconButtonLook, TRACK_ROW_CLASS, TRACK_TEXT_CLASS } from "./track-row-styles";
import { copy } from "@/copy";

export interface PlaylistRowProps {
  track: Track;
  /** Each absent action is hidden (not allowed to edit) or dimmed (cannot move further). */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove?: () => void;
  /** Show the edit buttons at all (the user may edit this playlist). */
  editable: boolean;
  /** An edit of this entry is on its way. */
  busy?: boolean;
}

/** One entry of a playlist. Title and artist are third-party text: shown as plain text only. */
export function PlaylistRow({
  track,
  onMoveUp,
  onMoveDown,
  onRemove,
  editable,
  busy = false,
}: PlaylistRowProps) {
  return (
    <View className={TRACK_ROW_CLASS}>
      <TrackCover track={track} />
      <View className={TRACK_TEXT_CLASS}>
        <Text variant="h3" numberOfLines={1}>
          {track.title}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {track.artist}
        </Text>
        <TrackPreviewProblem track={track} />
      </View>
      {busy ? (
        <ActivityIndicator color={colors.contentSecondary} />
      ) : editable ? (
        <View className="flex-row gap-2">
          <IconButton
            glyph="↑"
            label={copy.tracks.moveUp(track.title)}
            onPress={onMoveUp}
          />
          <IconButton
            glyph="↓"
            label={copy.tracks.moveDown(track.title)}
            onPress={onMoveDown}
          />
          <IconButton
            glyph="✕"
            label={copy.tracks.remove(track.title)}
            onPress={onRemove}
          />
        </View>
      ) : null}
    </View>
  );
}

function IconButton({
  glyph,
  label,
  onPress,
}: {
  glyph: string;
  label: string;
  onPress?: () => void;
}) {
  const disabled = !onPress;
  const look = iconButtonLook(disabled);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={look.container}
    >
      <Text variant="h3" tone={look.labelTone}>
        {glyph}
      </Text>
    </Pressable>
  );
}
