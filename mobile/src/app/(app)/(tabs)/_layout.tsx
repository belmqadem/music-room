import { Tabs } from "expo-router";

// Plain text labels for now: the design will define the icons.
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarIcon: () => null }}>
      <Tabs.Screen name="events" options={{ title: "Events" }} />
      <Tabs.Screen name="playlists" options={{ title: "Playlists" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
