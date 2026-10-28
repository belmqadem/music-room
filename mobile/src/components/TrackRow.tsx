import type { Track } from "@music-room/shared";
import { ActivityIndicator, Pressable, View } from "react-native";
import { colors } from "@/theme/tokens.generated";
import { Badge } from "./Badge";
import { Text } from "./Text";
import { TrackCover, TrackPreviewProblem } from "./TrackCover";
import { TRACK_ROW_CLASS, TRACK_TEXT_CLASS, voteLook } from "./track-row-styles";
import { copy } from "@/copy";

export interface TrackRowProps {
  track: Track;
  /** Shown on the right: the vote control (queued) or a "Playing" badge. */
  status: "queued" | "playing";
  voteCount: number;
  votedByMe: boolean;
  /** Absent: the count is shown but cannot be pressed (for example, not allowed to vote). */
  onToggleVote?: () => void;
  /** A vote or withdrawal for this track is on its way. */
  busy?: boolean;
}

/** One track of a queue. Title and artist come from a third party: shown as plain text only. */
export function TrackRow({
  track,
  status,
  voteCount,
  votedByMe,
  onToggleVote,
  busy = false,
}: TrackRowProps) {
  const disabled = !onToggleVote || busy;
  const look = voteLook(votedByMe, !onToggleVote);
  const votes = copy.tracks.votes(voteCount);

  return (
    <View className={TRACK_ROW_CLASS}>
      <TrackCover track={track} />
      <View className={TRACK_TEXT_CLASS}>
        <Text variant="h3" numberOfLines={1}>
          {track.title}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {track.artist} · {votes}
        </Text>
        <TrackPreviewProblem track={track} />
      </View>
      {status === "playing" ? (
        <Badge label={copy.tracks.playing} tone="accent" />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            votedByMe
              ? copy.tracks.removeVote(track.title)
              : copy.tracks.voteFor(track.title)
          }
          accessibilityState={{ selected: votedByMe, disabled, busy }}
          disabled={disabled}
          onPress={onToggleVote}
          className={look.container}
        >
          {busy ? (
            <ActivityIndicator
              color={votedByMe ? colors.contentInverse : colors.contentPrimary}
            />
          ) : (
            <Text variant="h3" tone={look.labelTone}>
              {votedByMe ? copy.tracks.voted : copy.tracks.vote}
            </Text>
          )}
        </Pressable>
      )}
    </View>
  );
}
