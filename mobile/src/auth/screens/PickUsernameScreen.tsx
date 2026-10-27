import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { auth } from "@/auth";
import { Button, Screen } from "@/components";
import { copy } from "@/copy";
import { FormMessage, ScreenTitle } from "./parts";
import { UsernameForm } from "./UsernameForm";

// The step every account goes through once, right after its first sign-in (ADR-046): by email
// after the code, with Google or Facebook, and existing accounts at their next sign-in. It can't
// be skipped: the server refuses everything else until a name is chosen. Signing out is the only
// other way out.
export default function PickUsernameScreen() {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut(): Promise<void> {
    setSigningOut(true);
    setError(null);
    try {
      await auth.signOut();
      router.replace("/");
    } catch (failure) {
      console.error("Sign-out failed:", failure);
      setError(copy.profile.signOutFailed);
      setSigningOut(false);
    }
  }

  return (
    <Screen scroll topInset>
      <View className="gap-8">
        <ScreenTitle
          title={copy.username.pickTitle}
          subtitle={copy.username.pickSubtitle}
        />
        {/* Once the name is saved the session says so and the app opens; this is a fallback. */}
        <UsernameForm onSaved={() => router.replace("/events")} />
        <View className="gap-3">
          <Button
            title={copy.profile.signOut}
            variant="ghost"
            fullWidth
            loading={signingOut}
            onPress={() => void signOut()}
          />
          {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        </View>
      </View>
    </Screen>
  );
}
