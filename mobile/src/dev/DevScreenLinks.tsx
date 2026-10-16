import { Link, type Href } from "expo-router";
import { Text, View } from "react-native";

// TEMP: remove before release. A jump list to every screen, shown on the welcome screen.
// "demo" stands in for a session id.
const SCREENS: [label: string, href: Href][] = [
  ["welcome", "/"],
  ["sign-in", "/sign-in"],
  ["sign-up", "/sign-up"],
  ["verify-email", "/verify-email"],
  ["forgot-password", "/forgot-password"],
  ["sessions (tab)", "/sessions"],
  ["profile (tab)", "/profile"],
  ["create-session", "/create-session"],
  ["session/[id]", "/session/demo"],
  ["session/[id]/track-vote", "/session/demo/track-vote"],
  ["session/[id]/playlist-editor", "/session/demo/playlist-editor"],
  ["settings", "/settings"],
];

export default function DevScreenLinks() {
  return (
    <View className="items-center">
      <Text>TEMP: remove before release</Text>
      {SCREENS.map(([label, href]) => (
        <Link key={label} href={href}>
          {label}
        </Link>
      ))}
    </View>
  );
}
