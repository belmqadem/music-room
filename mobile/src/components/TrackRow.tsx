import type { Track } from "@music-room/shared";
import { ActivityIndicator, Image, Pressable, View } from "react-native";
import { colors } from "@/theme/tokens.generated";
import { Badge } from "./Badge";
import { Text } from "./Text";
import {
  TRACK_COVER_CLASS,
  TRACK_ROW_CLASS,
  TRACK_TEXT_CLASS,
  voteLook,
} from "./track-row-styles";

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
  const votes = `${voteCount} ${voteCount === 1 ? "vote" : "votes"}`;

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
          {track.artist} · {votes}
        </Text>
      </View>
      {status === "playing" ? (
        <Badge label="Playing" tone="accent" />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            votedByMe ? `Remove your vote for ${track.title}` : `Vote for ${track.title}`
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
              {votedByMe ? "Voted" : "Vote"}
            </Text>
          )}
        </Pressable>
      )}
    </View>
  );
}
