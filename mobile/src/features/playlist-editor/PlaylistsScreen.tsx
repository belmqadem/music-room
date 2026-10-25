import type { Playlist } from "@music-room/shared";
import { router } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import { Badge, Button, Card, Text } from "@/components";
import { colors } from "@/theme";
import { editLicenseLabel, playlistTags } from "./messages";
import { usePlaylists } from "./use-playlists";
import { copy } from "@/copy";

// Playlists tab: public playlists, mine, and private ones I am invited to (the server decides which).
export default function PlaylistsScreen() {
  const { playlists, loading, refreshing, error, refresh, loadMore } = usePlaylists();

  return (
    <View className="flex-1 bg-canvas">
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.contentSecondary} />
        </View>
      ) : (
        <FlatList
          className="flex-1"
          contentContainerClassName="gap-3 px-5 py-6"
          data={playlists}
          keyExtractor={(playlist) => playlist.id}
          renderItem={({ item }) => <PlaylistListRow playlist={item} />}
          onEndReached={() => void loadMore()}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={colors.contentSecondary}
            />
          }
          ListHeaderComponent={
            error ? (
              <Text tone="error" accessibilityRole="alert">
                {error}
              </Text>
            ) : null
          }
          ListEmptyComponent={
            error ? null : <Text tone="secondary">{copy.playlists.empty}</Text>
          }
        />
      )}
      {/* At the bottom, within thumb reach, above the tab bar (which keeps clear of the home
          indicator); the list scrolls above it. Shown while loading too. */}
      <View className="px-5 pb-4 pt-2">
        <Button
          title={copy.playlists.create}
          fullWidth
          onPress={() => router.push("/create-playlist")}
        />
      </View>
    </View>
  );
}

function PlaylistListRow({ playlist }: { playlist: Playlist }) {
  const tags = playlistTags(playlist);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.playlists.open(playlist.name)}
      onPress={() => router.push(`/playlist/${playlist.id}`)}
    >
      <Card className="gap-2">
        <Text variant="h3" numberOfLines={1}>
          {playlist.name}
        </Text>
        <Text variant="caption" tone="secondary">
          {editLicenseLabel(playlist.editLicense)}
        </Text>
        {tags.length > 0 ? (
          <View className="flex-row gap-2">
            {tags.map((tag) => (
              <Badge key={tag} label={tag} />
            ))}
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}
