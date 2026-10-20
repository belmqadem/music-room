import type { MusicEvent } from "@music-room/shared";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import { Badge, Button, Card, Text, TrackRow } from "@/components";
import type { LiveStatus } from "@/sockets/live-connection";
import { colors } from "@/theme";
import { eventApi } from "./event-api";
import { voteLicenseLabel } from "./event-labels";
import { trackVoteErrorMessage } from "./messages";
import { useEventQueue } from "./use-event-queue";

// Track Vote (docs/api-contract.md, "Events"; ADR-034): the playing track, the ranked queue with my
// votes, and for the owner the button to move to the next track. Everyone sees changes live.
// `myPermissions` only decides what to show; the server checks every vote again.
export default function TrackVoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [event, setEvent] = useState<MusicEvent | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const queue = useEventQueue(id);

  useEffect(() => {
    let active = true;
    eventApi.get(id).then(
      (loaded) => {
        if (active) setEvent(loaded);
      },
      (error: unknown) => {
        if (active) setEventError(trackVoteErrorMessage(error));
      },
    );
    return () => {
      active = false;
    };
  }, [id]);

  const problem = eventError ?? queue.loadError;
  if (problem || queue.accessLost) {
    return (
      <Centered title={event?.name}>
        <Text tone="secondary" className="text-center">
          {queue.accessLost
            ? "You can no longer see this event: it was deleted, made private, or you were removed."
            : problem}
        </Text>
        <Button
          title="Back to events"
          variant="secondary"
          onPress={() => router.back()}
        />
      </Centered>
    );
  }
  if (!event || !queue.loaded) {
    return (
      <Centered title={event?.name}>
        <ActivityIndicator color={colors.contentSecondary} />
      </Centered>
    );
  }

  const { canAct, canManage } = event.myPermissions;
  const upNext = queue.tracks.filter((t) => t.status === "queued");

  return (
    <>
      <Stack.Screen options={{ title: event.name }} />
      <FlatList
        className="flex-1 bg-canvas"
        contentContainerClassName="gap-3 px-5 py-6"
        data={upNext}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => (
          <TrackRow
            track={item.track}
            status="queued"
            voteCount={item.voteCount}
            votedByMe={item.votedByMe}
            busy={queue.busyTrackId === item.id}
            // Withdrawing is always allowed to whoever voted; voting needs the license.
            onToggleVote={
              canAct || item.votedByMe ? () => void queue.toggleVote(item) : undefined
            }
          />
        )}
        ListHeaderComponent={
          <View className="gap-4 pb-1">
            <View className="flex-row items-center justify-between gap-3">
              <Text variant="caption" tone="secondary" className="flex-1">
                {voteLicenseLabel(event.voteLicense)}
                {event.visibility === "private" ? " · Private" : ""}
              </Text>
              <LiveBadge status={queue.status} />
            </View>

            {queue.playing ? (
              <TrackRow
                track={queue.playing.track}
                status="playing"
                voteCount={queue.playing.voteCount}
                votedByMe={queue.playing.votedByMe}
              />
            ) : (
              <Card>
                <Text tone="secondary">Nothing is playing.</Text>
              </Card>
            )}

            {canManage ? (
              <Button
                title={queue.playing ? "Next track" : "Start playing"}
                fullWidth
                loading={queue.advancing}
                disabled={!queue.playing && upNext.length === 0}
                onPress={() => void queue.advance()}
              />
            ) : null}

            {queue.actionError ? (
              <Text tone="error" accessibilityRole="alert">
                {queue.actionError}
              </Text>
            ) : null}
            {!canAct ? (
              <Text variant="caption" tone="secondary">
                You can follow this event, but not vote in it.
              </Text>
            ) : null}

            <Text variant="h3">Up next</Text>
          </View>
        }
        ListEmptyComponent={<Text tone="secondary">No tracks in the queue yet.</Text>}
      />
    </>
  );
}

/** Chartreuse is for live state only (DESIGN.md rule 4): shown only while updates really arrive. */
function LiveBadge({ status }: { status: LiveStatus }) {
  if (status === "live") return <Badge label="Live" tone="live" />;
  if (status === "offline") return <Badge label="Not live" tone="error" />;
  return <Badge label="Connecting" />;
}

function Centered({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <>
      <Stack.Screen options={{ title: title ?? "" }} />
      <View className="flex-1 items-center justify-center gap-4 bg-canvas px-5">
        {children}
      </View>
    </>
  );
}
