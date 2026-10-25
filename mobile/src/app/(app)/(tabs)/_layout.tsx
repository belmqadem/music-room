import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { Tabs } from "expo-router";
import type { ColorValue } from "react-native";
import { LargeHeader } from "@/components";
import { colors, typography } from "@/theme";
import { copy } from "@/copy";

// Each tab's title is the app's large header (display font, left-aligned). The bar is a surface
// tier with a hairline on top. The active tab (icon and label) reads as
// primary text and the others as tertiary, the token for inactive icons. Icons are SF Symbols on
// iOS and Material Symbols on Android and web (expo-symbols); the bar gives their size and color.
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        header: ({ options }) => <LargeHeader title={options.title ?? ""} />,
        tabBarStyle: {
          backgroundColor: colors.surfaceLow,
          borderTopColor: colors.lineSubtle,
        },
        tabBarActiveTintColor: colors.contentPrimary,
        tabBarInactiveTintColor: colors.contentTertiary,
        tabBarLabelStyle: typography.caption,
      }}
    >
      <Tabs.Screen
        name="events"
        options={{
          title: copy.tabs.rooms,
          tabBarIcon: tabIcon({ ios: "calendar", android: "event", web: "event" }),
        }}
      />
      <Tabs.Screen
        name="playlists"
        options={{
          title: copy.tabs.playlists,
          tabBarIcon: tabIcon({
            ios: "music.note.list",
            android: "queue_music",
            web: "queue_music",
          }),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: copy.tabs.profile,
          tabBarIcon: tabIcon({
            ios: "person.crop.circle",
            android: "account_circle",
            web: "account_circle",
          }),
        }}
      />
    </Tabs>
  );
}

function tabIcon(name: SymbolViewProps["name"]) {
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <SymbolView name={name} tintColor={color} size={size} />;
  };
}
