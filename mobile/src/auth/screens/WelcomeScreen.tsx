import { router } from "expo-router";
import { View } from "react-native";
import { Button, Screen, Text } from "@/components";
import DevScreenLinks from "@/dev/DevScreenLinks";

// The first screen when signed out: what the app is, and the two ways in. One primary action.
export default function WelcomeScreen() {
  return (
    <Screen scroll topInset>
      <View className="flex-1 justify-center gap-4 py-12">
        <Text variant="hero">Shape the room’s music, together.</Text>
        <Text variant="bodyLarge" tone="secondary">
          Vote on what plays next and edit shared playlists live, with everyone in the
          room.
        </Text>
      </View>
      <View className="gap-3">
        <Button
          title="Create an account"
          fullWidth
          onPress={() => router.push("/sign-up")}
        />
        <Button
          title="Sign in"
          variant="secondary"
          fullWidth
          onPress={() => router.push("/sign-in")}
        />
      </View>
      {/* TEMP: remove before release, with src/dev. */}
      <View className="pt-12">
        <DevScreenLinks />
      </View>
    </Screen>
  );
}
