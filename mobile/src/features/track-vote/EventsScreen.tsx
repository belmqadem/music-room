import type { MusicEvent } from "@music-room/shared";
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
import { eventTags, voteLicenseLabel } from "./event-labels";
import { useEvents } from "./use-events";
import { copy } from "@/copy";

// Events tab: public events, mine, and private ones I am invited to (the server decides which).
export default function EventsScreen() {
  const { events, loading, refreshing, error, refresh, loadMore } = useEvents();

  return (
    <View className="flex-1 bg-canvas">
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.contentSecondary} />
        </View>
      ) : (
        <FlatList
          className="flex-1"
          contentContainerClassName="flex-grow gap-3 px-5 py-6"
          data={events}
          keyExtractor={(event) => event.id}
          renderItem={({ item }) => <EventRow event={item} />}
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
            // The list grows to the space above the button, so this sits in its middle.
            error ? null : (
              <View className="flex-1 items-center justify-center">
                <Text tone="secondary" className="text-center">
                  {copy.rooms.empty}
                </Text>
              </View>
            )
          }
        />
      )}
      {/* At the bottom, within thumb reach, above the tab bar (which keeps clear of the home
          indicator); the list scrolls above it. Shown while loading too. */}
      <View className="px-5 pb-4 pt-2">
        <Button
          title={copy.rooms.create}
          fullWidth
          onPress={() => router.push("/create-event")}
        />
      </View>
    </View>
  );
}

function EventRow({ event }: { event: MusicEvent }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.rooms.open(event.name)}
      onPress={() => router.push(`/event/${event.id}`)}
    >
      <Card className="gap-2">
        <Text variant="h3" numberOfLines={1}>
          {event.name}
        </Text>
        <Text variant="caption" tone="secondary">
          {voteLicenseLabel(event.voteLicense)}
        </Text>
        {eventTags(event).length > 0 ? (
          <View className="flex-row gap-2">
            {eventTags(event).map((tag) => (
              <Badge key={tag} label={tag} />
            ))}
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}
