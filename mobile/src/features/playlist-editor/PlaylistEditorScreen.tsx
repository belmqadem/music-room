import type { Playlist } from "@music-room/shared";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import { TrackSearchSheet } from "@/catalog/TrackSearchSheet";
import { Button, PlaylistRow, Text } from "@/components";
import { LiveBadge } from "@/sockets/LiveBadge";
import { colors } from "@/theme";
import { editLicenseLabel, playlistErrorMessage } from "./messages";
import { playlistApi } from "./playlist-api";
import { usePlaylist } from "./use-playlist";
import { copy } from "@/copy";

// Playlist Editor (docs/api-contract.md, "Playlists"; ADR-036): the ordered list, live for everyone;
// anyone allowed to edit adds, moves and removes any entry. `myPermissions` only decides what to
// show; the server checks every edit again.
export default function PlaylistEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const editor = usePlaylist(id);

  useEffect(() => {
    let active = true;
    playlistApi.get(id).then(
      (loaded) => {
        if (active) setPlaylist(loaded);
      },
      (error: unknown) => {
        if (active) setPlaylistError(playlistErrorMessage(error));
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

  const { canAct, canManage } = playlist.myPermissions;
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
            <View className="flex-row items-center justify-between gap-3">
              <Text variant="caption" tone="secondary" className="flex-1">
                {editLicenseLabel(playlist.editLicense)}
                {playlist.visibility === "private" ? copy.common.privateSuffix : ""}
                {copy.playlistEditor.trackCount(editor.entries.length)}
              </Text>
              <LiveBadge />
            </View>
            {canAct ? (
              <Button
                title={copy.playlistEditor.addTrack}
                fullWidth
                onPress={() => setAdding(true)}
              />
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
