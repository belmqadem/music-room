import { Stack } from "expo-router";
import { Screen } from "@/components";
import { ServerAddressForm } from "./ServerAddressForm";
import { copy } from "@/copy";

// Before signing in: which server the app talks to (e.g. the defense machine on the local network).
export default function ServerAddressScreen() {
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: copy.settings.serverAddressTitle }} />
      <ServerAddressForm editable />
    </Screen>
  );
}
