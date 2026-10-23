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

// Playlists tab: public playlists, mine, and private ones I am invited to (the server decides which).
export default function PlaylistsScreen() {
  const { playlists, loading, refreshing, error, refresh, loadMore } = usePlaylists();

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator color={colors.contentSecondary} />
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-canvas"
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
        <View className="gap-3 pb-1">
          <Button
            title="Create a playlist"
            fullWidth
            onPress={() => router.push("/create-playlist")}
          />
          {error ? (
            <Text tone="error" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        error ? null : (
          <Text tone="secondary">No playlists yet. Pull down to check again.</Text>
        )
      }
    />
  );
}

function PlaylistListRow({ playlist }: { playlist: Playlist }) {
  const tags = playlistTags(playlist);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${playlist.name}`}
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
