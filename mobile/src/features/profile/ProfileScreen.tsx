import type { Profile } from "@music-room/shared";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { auth, useAuth } from "@/auth";
import { Button, Card, Icon, type IconName, Screen, Text } from "@/components";
import { copy } from "@/copy";
import { colors } from "@/theme";
import { initialsOf } from "./initials";
import { profileErrorMessage } from "./messages";
import { ProfileBlocks } from "./ProfileBlocks";
import { profileApi } from "./profile-api";

// Your profile (docs/api-contract.md, "Profiles"; ADR-024, ADR-039): who you are at the top (initials,
// name, email), then the blocks as the server has them, each section with its own edit button, then
// the account rows.
// Read again each time the tab shows, so an edit appears on return.
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
  if (!user) {
    return (
      <Screen>
        <Text tone="secondary">{copy.profile.notSignedIn}</Text>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View className="gap-8">
        <View className="items-center gap-4">
          <View className="h-24 w-24 items-center justify-center rounded-full border border-line-subtle bg-surface-elevated">
            <Text variant="hero">{initialsOf(user.displayName)}</Text>
          </View>
          <View className="items-center gap-1">
            <Text variant="h1" className="text-center">
              {user.displayName}
            </Text>
            {user.email ? <Text tone="secondary">{user.email}</Text> : null}
          </View>
        </View>

        {profile ? (
          <ProfileBlocks
            profile={profile}
            onEdit={(section) =>
              router.push({ pathname: "/edit-profile", params: { section } })
            }
          />
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
          <Card>
            <Row
              icon="settings"
              label={copy.profile.settings}
              onPress={() => router.push("/settings")}
            />
            <View className="h-px bg-line-subtle" />
            <Row
              icon="signOut"
              label={copy.profile.signOut}
              danger
              busy={signingOut}
              onPress={() => void signOut()}
            />
          </Card>
          {error ? (
            <Text tone="error" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

/** A row of the account list: icon and label; a chevron when it opens a screen, a spinner while busy. */
function Row({
  icon,
  label,
  onPress,
  danger = false,
  busy = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled: busy }}
      className="flex-row items-center gap-3 rounded-lg py-3 active:opacity-70"
    >
      <Icon name={icon} size="h3" tone={danger ? "error" : "secondary"} />
      <Text tone={danger ? "error" : "primary"} className="flex-1">
        {label}
      </Text>
      {busy ? (
        <ActivityIndicator color={colors.contentSecondary} />
      ) : danger ? null : (
        <Icon name="chevronRight" tone="tertiary" />
      )}
    </Pressable>
  );
}
