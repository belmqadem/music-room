import { Link, type Href } from "expo-router";
import { View } from "react-native";
import { Text } from "@/components";
import { colors } from "@/theme";

// TEMP: remove before release. A jump list to every screen, shown on the welcome screen.
// "demo" stands in for an event or playlist id.
const SCREENS: [label: string, href: Href][] = [
  ["welcome", "/"],
  ["component gallery", "/gallery"],
  ["sign-in", "/sign-in"],
  ["sign-up", "/sign-up"],
  ["verify-email", "/verify-email"],
  ["forgot-password", "/forgot-password"],
  ["events (tab)", "/events"],
  ["playlists (tab)", "/playlists"],
  ["profile (tab)", "/profile"],
  ["create-event", "/create-event"],
  ["create-playlist", "/create-playlist"],
  ["event/[id] (Track Vote)", "/event/demo"],
  ["playlist/[id] (Playlist Editor)", "/playlist/demo"],
  ["settings", "/settings"],
];

export default function DevScreenLinks() {
  return (
    <View className="items-center gap-2">
      <Text variant="badge" tone="tertiary">
        TEMP: remove before release
      </Text>
      {SCREENS.map(([label, href]) => (
        <Link key={label} href={href} style={{ color: colors.contentSecondary }}>
          {label}
        </Link>
      ))}
    </View>
  );
}
