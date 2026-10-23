import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { auth, useAuth } from "@/auth";
import { Button, Screen, Text } from "@/components";

// Profile: public, friends-only and private info, and music preferences (to come). For now: who is
// signed in, and signing out.
export default function ProfileScreen() {
  const state = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setSigningOut(true);
    setError(null);
    try {
      // Revokes the session on the server when it can be reached; the phone forgets it either way.
      await auth.signOut();
      router.replace("/");
    } catch (failure) {
      // Only the phone's secure storage can fail here; the session may still be stored.
      console.error("Sign-out failed:", failure);
      setError("Could not sign out. Try again.");
      setSigningOut(false);
    }
  }

  const user = state.status === "signedIn" ? state.user : null;
  return (
    <Screen>
      <View className="flex-1 justify-between">
        <View className="gap-1">
          {user ? (
            <>
              <Text variant="h2">{user.displayName}</Text>
              {user.email ? <Text tone="secondary">{user.email}</Text> : null}
            </>
          ) : (
            <Text tone="secondary">Not signed in.</Text>
          )}
        </View>
        <View className="gap-3">
          {error ? (
            <Text tone="error" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button
            title="Settings"
            variant="ghost"
            fullWidth
            onPress={() => router.push("/settings")}
          />
          <Button
            title="Sign out"
            variant="secondary"
            fullWidth
            loading={signingOut}
            disabled={!user}
            onPress={() => void signOut()}
          />
        </View>
      </View>
    </Screen>
  );
}
