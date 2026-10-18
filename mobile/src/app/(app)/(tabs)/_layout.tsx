import { Tabs } from "expo-router";
import { colors, typography } from "@/theme";

// Plain text labels for now: the design will define the icons. The bar is a surface tier with a
// hairline on top, the active tab reads as primary text and the others as inactive.
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarIcon: () => null,
        tabBarStyle: {
          backgroundColor: colors.surfaceLow,
          borderTopColor: colors.lineSubtle,
        },
        tabBarActiveTintColor: colors.contentPrimary,
        tabBarInactiveTintColor: colors.contentTertiary,
        tabBarLabelStyle: typography.caption,
      }}
    >
      <Tabs.Screen name="events" options={{ title: "Events" }} />
      <Tabs.Screen name="playlists" options={{ title: "Playlists" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
