import type { Profile } from "@music-room/shared";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { auth, useAuth } from "@/auth";
import {
  Badge,
  Button,
  Card,
  Icon,
  OfflineNotice,
  Screen,
  Text,
  type IconName,
} from "@/components";
import { isUnreachable, offlineStore } from "@/offline";
import { copy } from "@/copy";
import { isPremium } from "@/features/plan/plan";
import { friendsApi } from "@/features/friends/friends-api";
import { requestCountLabel } from "@/features/friends/friend-state";
import { colors } from "@/theme";
import { profileErrorMessage } from "./messages";
import { ProfileBlocks } from "./ProfileBlocks";
import { offlineProfile } from "./profile-form";
import { ProfileHeader } from "./ProfileHeader";
import { profileApi } from "./profile-api";

// Your profile (docs/api-contract.md, "Profiles"; ADR-024, ADR-039): who you are at the top (initials,
// name, email), then the blocks as the server has them, each section with its own edit button, then
// the account rows: Friends (with the number of requests waiting), Settings, Sign out.
// Read again each time the tab shows, so an edit or a new request appears on return.
const PROFILE_CACHE = "profile";

export default function ProfileScreen() {
  const state = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);

  const load = useCallback(() => {
    let active = true;
    setLoadError(null);
    profileApi.mine().then(
      (loaded) => {
        if (!active) return;
        setProfile(loaded);
        // Kept for offline mode (ADR-049), without the private block.
        void offlineStore.write(PROFILE_CACHE, offlineProfile(loaded));
      },
      async (failure: unknown) => {
        const copy = isUnreachable(failure)
          ? await offlineStore.read<Profile>(PROFILE_CACHE)
          : null;
        if (!active) return;
        if (copy) {
          setProfile(copy.data);
        } else setLoadError(profileErrorMessage(failure));
      },
    );
    // Requests are not pushed live yet: this read is how a new one shows. If it fails the row just
    // has no number; the Friends screen reads the list itself and says what went wrong.
    friendsApi.requests("incoming").then(
      (page) => {
        if (active)
          setWaiting(requestCountLabel(page.items.length, page.nextCursor !== null));
      },
      (failure: unknown) => console.warn("Friend requests count failed:", failure),
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
        <ProfileHeader
          displayName={user.displayName}
          subtitle={
            <>
              {user.email ? <Text tone="secondary">{user.email}</Text> : null}
              {isPremium(user) ? (
                <View className="pt-1">
                  <Badge label={copy.plan.badge} tone="accent" />
                </View>
              ) : null}
            </>
          }
        />

        <OfflineNotice />
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
              icon="friends"
              label={copy.profile.friends}
              count={waiting}
              accessibilityLabel={
                waiting ? copy.profile.friendsWaiting(waiting) : undefined
              }
              onPress={() => router.push("/friends")}
            />
            <View className="h-px bg-line-subtle" />
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

/**
 * A row of the account list: icon and label; a number when something waits there, a chevron when
 * it opens a screen, a spinner while busy.
 */
function Row({
  icon,
  label,
  onPress,
  count = null,
  accessibilityLabel,
  danger = false,
  busy = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  count?: string | null;
  accessibilityLabel?: string;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy, disabled: busy }}
      className="flex-row items-center gap-3 rounded-lg py-3 active:opacity-70"
    >
      <Icon name={icon} size="h3" tone={danger ? "error" : "secondary"} />
      <Text tone={danger ? "error" : "primary"} className="flex-1">
        {label}
      </Text>
      {count ? <Badge label={count} tone="accent" /> : null}
      {busy ? (
        <ActivityIndicator color={colors.contentSecondary} />
      ) : danger ? null : (
        <Icon name="chevronRight" tone="tertiary" />
      )}
    </Pressable>
  );
}
