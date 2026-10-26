import { router, Stack } from "expo-router";
import { View } from "react-native";
import { useAuth } from "@/auth";
import { Card, IconButton, Screen, Text } from "@/components";
import { copy } from "@/copy";
import { ServerAddressForm } from "./ServerAddressForm";
import { SignInMethods } from "./SignInMethods";

// Settings while signed in: your username (ADR-046), your sign-in methods (link and unlink Google
// or Facebook), then the server address, read-only (sign out to change it).
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
        {user ? <SignInMethods user={user} /> : null}
        <ServerAddressForm editable={false} />
      </View>
    </Screen>
  );
}
