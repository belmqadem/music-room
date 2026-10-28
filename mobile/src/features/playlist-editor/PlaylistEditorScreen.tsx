import type { Playlist } from "@music-room/shared";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import { useStopPreviewOnLeave } from "@/audio/use-preview";
import { useAuth } from "@/auth";
import { TrackSearchSheet } from "@/catalog/TrackSearchSheet";
import { playlistEditing } from "@/features/plan/plan";
import { Button, OfflineNotice, PlaylistRow, Text } from "@/components";
import { isUnreachable, offlineStore, useOnline } from "@/offline";
import { LiveBadge } from "@/sockets/LiveBadge";
import { colors } from "@/theme";
import { editLicenseLabel, playlistErrorMessage } from "./messages";
import { playlistApi } from "./playlist-api";
import { SyncSummaryNotice } from "./SyncSummaryNotice";
import { usePlaylist } from "./use-playlist";
import { copy } from "@/copy";

// Playlist Editor (docs/api-contract.md, "Playlists"; ADR-036): the ordered list, live for everyone;
// anyone allowed to edit adds, moves and removes any entry. `myPermissions` only decides what to
// show; the server checks every edit again.
export default function PlaylistEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useStopPreviewOnLeave();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const editor = usePlaylist(id);
  const online = useOnline();
  const auth = useAuth();

  useEffect(() => {
    let active = true;
    // Kept for offline mode (ADR-049): its name and what you may do with it, as last seen.
    const cacheName = `playlist:${id}`;
    playlistApi.get(id).then(
      (loaded) => {
        if (!active) return;
        setPlaylist(loaded);
        void offlineStore.write(cacheName, loaded);
      },
      async (error: unknown) => {
        const copy = isUnreachable(error)
          ? await offlineStore.read<Playlist>(cacheName)
          : null;
        if (!active) return;
        if (copy) setPlaylist(copy.data);
        else setPlaylistError(playlistErrorMessage(error));
      },
    );
    return () => {
      active = false;
    };
  }, [id]);

  const problem = playlistError ?? editor.loadError;
  if (problem || editor.accessLost) {
    return (
      <Centered title={playlist?.name}>
        <Text tone="secondary" className="text-center">
          {editor.accessLost ? copy.playlistEditor.accessLost : problem}
        </Text>
        <Button
          title={copy.playlistEditor.backToPlaylists}
          variant="secondary"
          fullWidth
          onPress={() => router.back()}
        />
      </Centered>
    );
  }
  if (!playlist || !editor.loaded) {
    return (
      <Centered title={playlist?.name}>
        <ActivityIndicator color={colors.contentSecondary} />
      </Centered>
    );
  }

  const { canManage } = playlist.myPermissions;
  // The license says whether you may edit this playlist; the plan whether you can (ADR-048).
  const editing = playlistEditing(
    playlist.myPermissions.canAct,
    auth.status === "signedIn" ? auth.user : null,
  );
  const canAct = editing === "allowed";
  return (
    <>
      <Stack.Screen options={{ title: playlist.name }} />
      <FlatList
        className="flex-1 bg-canvas"
        contentContainerClassName="gap-3 px-5 py-6"
        data={editor.entries}
        keyExtractor={(entry) => entry.id}
        renderItem={({ item, index }) => (
          <PlaylistRow
            track={item.track}
            editable={canAct}
            busy={editor.busyEntryId === item.id}
            onMoveUp={editor.canMoveUp(index) ? () => editor.moveUp(index) : undefined}
            onMoveDown={
              editor.canMoveDown(index) ? () => editor.moveDown(index) : undefined
            }
            onRemove={() => editor.remove(item.id)}
          />
        )}
        ListHeaderComponent={
          <View className="gap-4 pb-1">
            <OfflineNotice />
            <SyncSummaryNotice />
            <View className="flex-row items-center justify-between gap-3">
              <Text variant="caption" tone="secondary" className="flex-1">
                {editLicenseLabel(playlist.editLicense)}
                {playlist.visibility === "private" ? copy.common.privateSuffix : ""}
                {copy.playlistEditor.trackCount(editor.entries.length)}
              </Text>
              <LiveBadge />
            </View>
            {canAct ? (
              <View className="gap-2">
                <Button
                  title={copy.playlistEditor.addTrack}
                  fullWidth
                  disabled={!online}
                  onPress={() => setAdding(true)}
                />
                {online ? null : (
                  <Text variant="caption" tone="secondary">
                    {copy.offline.addNeedsConnection}
                  </Text>
                )}
              </View>
            ) : editing === "needs-premium" ? (
              <View className="gap-2">
                <Text variant="caption" tone="secondary">
                  {copy.plan.locked.playlistEdit}
                </Text>
                <Button
                  title={copy.plan.seePremium}
                  variant="secondary"
                  fullWidth
                  onPress={() => router.push("/plan")}
                />
              </View>
            ) : (
              <Text variant="caption" tone="secondary">
                {copy.playlistEditor.listenOnly}
              </Text>
            )}
            {canManage &&
            (playlist.visibility === "private" ||
              playlist.editLicense.type === "invited_only") ? (
              // Invitations matter only when they change something: who sees it, or who edits.
              <Button
                title={copy.common.invitePeople}
                variant="secondary"
                fullWidth
                onPress={() => router.push(`/invitations/playlist/${playlist.id}`)}
              />
            ) : null}
            {editor.actionError ? (
              <Text tone="error" accessibilityRole="alert">
                {editor.actionError}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Text tone="secondary">
            {canAct ? copy.playlistEditor.empty : copy.playlistEditor.emptyListenOnly}
          </Text>
        }
      />
      <TrackSearchSheet
        visible={adding}
        title={copy.playlistEditor.addTrack}
        actionLabel={copy.playlistEditor.addAction}
        searchErrorMessage={playlistErrorMessage}
        onClose={() => setAdding(false)}
        onPick={(track) => editor.add(track.providerTrackId)}
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
