import type { Profile } from "@music-room/shared";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { auth, useAuth } from "@/auth";
import { Button, Screen, Text } from "@/components";
import { copy } from "@/copy";
import { colors } from "@/theme";
import { profileErrorMessage } from "./messages";
import { ProfileBlocks } from "./ProfileBlocks";
import { profileApi } from "./profile-api";

// Your profile (docs/api-contract.md, "Profiles"; ADR-024): the four blocks as the server has them,
// read again each time the tab shows (so an edit appears on return), then Edit, Settings, Sign out.
export default function ProfileScreen() {
  const state = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let active = true;
    setLoadError(null);
    profileApi.mine().then(
      (loaded) => {
        if (active) setProfile(loaded);
      },
      (failure: unknown) => {
        if (active) setLoadError(profileErrorMessage(failure));
      },
    );
    return () => {
      active = false;
    };
  }, []);
  useFocusEffect(load);

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
      setError(copy.profile.signOutFailed);
      setSigningOut(false);
    }
  }

  const user = state.status === "signedIn" ? state.user : null;
  return (
    <Screen scroll>
      <View className="gap-6">
        <View className="gap-1">
          {user ? (
            <>
              <Text variant="h2">{user.displayName}</Text>
              {user.email ? <Text tone="secondary">{user.email}</Text> : null}
            </>
          ) : (
            <Text tone="secondary">{copy.profile.notSignedIn}</Text>
          )}
        </View>

        {profile ? (
          <ProfileBlocks profile={profile} />
        ) : loadError ? (
          <View className="gap-3">
            <Text tone="error" accessibilityRole="alert">
              {copy.profile.loadFailed} {loadError}
            </Text>
            <Button title={copy.common.tryAgain} variant="secondary" onPress={load} />
          </View>
        ) : (
          <ActivityIndicator color={colors.contentSecondary} />
        )}

        <View className="gap-3">
          {error ? (
            <Text tone="error" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button
            title={copy.profile.edit}
            fullWidth
            disabled={!profile}
            onPress={() => router.push("/edit-profile")}
          />
          <Button
            title={copy.profile.settings}
            variant="ghost"
            fullWidth
            onPress={() => router.push("/settings")}
          />
          <Button
            title={copy.profile.signOut}
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
