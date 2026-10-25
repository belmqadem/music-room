import { Stack } from "expo-router";
import { Screen } from "@/components";
import { ServerAddressForm } from "./ServerAddressForm";
import { copy } from "@/copy";

// Settings while signed in: the server address, read-only (sign out to change it).
export default function SettingsScreen() {
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: copy.settings.title }} />
      <ServerAddressForm editable={false} />
    </Screen>
  );
}
