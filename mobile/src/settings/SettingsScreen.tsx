import { Stack } from "expo-router";
import { View } from "react-native";
import { useAuth } from "@/auth";
import { Screen } from "@/components";
import { copy } from "@/copy";
import { ServerAddressForm } from "./ServerAddressForm";
import { SignInMethods } from "./SignInMethods";

// Settings while signed in: your sign-in methods (link and unlink Google or Facebook), then the
// server address, read-only (sign out to change it).
export default function SettingsScreen() {
  const state = useAuth();
  const user = state.status === "signedIn" ? state.user : null;
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: copy.settings.title }} />
      <View className="gap-8">
        {user ? <SignInMethods user={user} /> : null}
        <ServerAddressForm editable={false} />
      </View>
    </Screen>
  );
}
