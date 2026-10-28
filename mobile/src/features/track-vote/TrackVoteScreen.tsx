import type { MusicEvent } from "@music-room/shared";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import { useStopPreviewOnLeave } from "@/audio/use-preview";
import { Button, Card, OfflineNotice, Text, TrackRow } from "@/components";
import { isUnreachable, offlineStore } from "@/offline";
import { LiveBadge } from "@/sockets/LiveBadge";
import { colors } from "@/theme";
import { eventApi } from "./event-api";
import { locationRuleText, voteLicenseLabel } from "./event-labels";
import { trackVoteErrorMessage } from "./messages";

import { useEventQueue } from "./use-event-queue";
import { TrackSearchSheet } from "@/catalog/TrackSearchSheet";
import { copy } from "@/copy";

// Track Vote (docs/api-contract.md, "Events"; ADR-034): the playing track, the ranked queue with my
// votes, and for the owner the button to move to the next track. Everyone sees changes live.
// `myPermissions` only decides what to show; the server checks every vote again.
export default function TrackVoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useStopPreviewOnLeave();
  const [event, setEvent] = useState<MusicEvent | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const queue = useEventQueue(id);
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    let active = true;
    // Kept for offline mode (ADR-049): its name and rules, as last seen.
    const cacheName = `room:${id}`;
    eventApi.get(id).then(
      (loaded) => {
        if (!active) return;
        setEvent(loaded);
        void offlineStore.write(cacheName, loaded);
      },
      async (error: unknown) => {
        const copy = isUnreachable(error)
          ? await offlineStore.read<MusicEvent>(cacheName)
          : null;
        if (!active) return;
        if (copy) setEvent(copy.data);
        else setEventError(trackVoteErrorMessage(error));
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
          {queue.accessLost ? copy.trackVote.accessLost : problem}
        </Text>
        <Button
          title={copy.trackVote.backToRooms}
          variant="secondary"
          fullWidth
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
            <OfflineNotice />
            <View className="flex-row items-center justify-between gap-3">
              <Text variant="caption" tone="secondary" className="flex-1">
                {voteLicenseLabel(event.voteLicense)}
                {event.visibility === "private" ? copy.common.privateSuffix : ""}
              </Text>
              <LiveBadge />
            </View>
            {event.voteLicense.type === "location_time" ? (
              <Text variant="caption" tone="secondary">
                {locationRuleText(event.voteLicense)}
                {canManage ? copy.trackVote.ownerRuleNote : ""}
              </Text>
            ) : null}

            {queue.playing ? (
              <TrackRow
                track={queue.playing.track}
                status="playing"
                voteCount={queue.playing.voteCount}
                votedByMe={queue.playing.votedByMe}
              />
            ) : (
              <Card>
                <Text tone="secondary">{copy.trackVote.nothingPlaying}</Text>
              </Card>
            )}

            {canManage ? (
              <Button
                title={
                  queue.playing ? copy.trackVote.nextTrack : copy.trackVote.startPlaying
                }
                fullWidth
                loading={queue.advancing}
                disabled={!queue.playing && upNext.length === 0}
                onPress={() => void queue.advance()}
              />
            ) : null}

            {canManage &&
            (event.visibility === "private" ||
              event.voteLicense.type === "invited_only") ? (
              // Invitations matter only when they change something: who sees it, or who votes.
              <Button
                title={copy.common.invitePeople}
                variant="secondary"
                fullWidth
                onPress={() => router.push(`/invitations/event/${event.id}`)}
              />
            ) : null}
            {canAct ? (
              // Secondary: the screen's one Ember button is the owner's "Next track".
              <Button
                title={copy.trackVote.suggest}
                variant="secondary"
                fullWidth
                onPress={() => setSuggesting(true)}
              />
            ) : (
              <Text variant="caption" tone="secondary">
                {copy.trackVote.followOnly}
              </Text>
            )}

            {queue.actionError ? (
              <Text tone="error" accessibilityRole="alert">
                {queue.actionError}
              </Text>
            ) : null}
            {queue.notice ? (
              <Text tone="secondary" accessibilityLiveRegion="polite">
                {queue.notice}
              </Text>
            ) : null}

            <Text variant="h3">{copy.trackVote.upNext}</Text>
          </View>
        }
        ListEmptyComponent={
          <Text tone="secondary">
            {canAct ? copy.trackVote.emptyQueue : copy.trackVote.emptyQueueFollowOnly}
          </Text>
        }
      />
      <TrackSearchSheet
        title={copy.trackVote.suggest}
        actionLabel={copy.trackVote.suggestAction}
        searchErrorMessage={trackVoteErrorMessage}
        visible={suggesting}
        onClose={() => setSuggesting(false)}
        onPick={(track) => queue.suggest(track.providerTrackId)}
      />
    </>
  );
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
