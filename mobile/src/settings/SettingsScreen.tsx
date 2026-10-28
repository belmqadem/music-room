import { router, Stack } from "expo-router";
import { View } from "react-native";
import { useAuth } from "@/auth";
import { Card, IconButton, Screen, Text } from "@/components";
import { copy } from "@/copy";
import { NearbyRoomsSetting } from "@/features/nearby/NearbyRoomsSetting";
import { isPremium } from "@/features/plan/plan";
import { SignInMethods } from "./SignInMethods";

// Settings while signed in: your username (ADR-046), your plan, rooms near you (ADR-052) and your
// sign-in methods (link and unlink Google or Facebook). The server address is set while signed out (Welcome, Server address).
export default function SettingsScreen() {
  const state = useAuth();
  const user = state.status === "signedIn" ? state.user : null;
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: copy.settings.title }} />
      <View className="gap-8">
        {user ? (
          <Card className="min-h-12 flex-row items-center gap-3">
            <View className="flex-1 gap-1">
              <Text>{copy.username.label}</Text>
              <Text variant="caption" tone="secondary" numberOfLines={1}>
                {user.displayName}
              </Text>
            </View>
            <IconButton
              icon="edit"
              accessibilityLabel={copy.username.changeName}
              onPress={() => router.push("/username")}
            />
          </Card>
        ) : null}
        {user ? (
          <Card className="min-h-12 flex-row items-center gap-3">
            <View className="flex-1 gap-1">
              <Text>{copy.plan.settingsRow}</Text>
              <Text variant="caption" tone="secondary">
                {copy.plan.names[isPremium(user) ? "premium" : "free"]}
              </Text>
            </View>
            <IconButton
              icon="chevronRight"
              accessibilityLabel={copy.plan.seePlans}
              onPress={() => router.push("/plan")}
            />
          </Card>
        ) : null}
        {user ? <NearbyRoomsSetting /> : null}
        {user ? <SignInMethods user={user} /> : null}
      </View>
    </Screen>
  );
}
