import type { Profile } from "@music-room/shared";
import { Redirect, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { isRequestError } from "@/api/api-error";
import { useAuth } from "@/auth";
import { Button, Screen, Text } from "@/components";
import { copy } from "@/copy";
import { friendsApi } from "@/features/friends/friends-api";
import { friendStateOf, type FriendState } from "@/features/friends/friend-state";
import { friendsErrorMessage } from "@/features/friends/messages";
import { colors } from "@/theme";
import { profileErrorMessage } from "./messages";
import { ProfileBlocks } from "./ProfileBlocks";
import { ProfileHeader } from "./ProfileHeader";
import { profileApi } from "./profile-api";

// Someone else's profile (docs/api-contract.md, "Profiles" and "Friends"; ADR-024, ADR-042): only
// the blocks the server sends (their full name and city, for a friend, under their name), and the
// one friend action where you stand with them. After any
// action the profile is read again: the server's answer is what shows, also after a conflict
// (they accepted or cancelled meanwhile).
export default function PersonProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useAuth();
  const myId = state.status === "signedIn" ? (state.user?.id ?? null) : null;
  if (typeof id !== "string" || id === "" || !myId) {
    return (
      <Screen>
        <Text tone="secondary">{copy.friends.notFound}</Text>
      </Screen>
    );
  }
  // Your own profile is the Profile tab, with its edit buttons.
  if (id === myId) return <Redirect href="/profile" />;
  return <PersonProfile userId={id} myId={myId} />;
}

type Notice = { tone: "success" | "error"; text: string };

function PersonProfile({ userId, myId }: { userId: string; myId: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(() => {
    let active = true;
    setLoadError(null);
    profileApi.of(userId).then(
      (loaded) => {
        if (active) setProfile(loaded);
      },
      (failure: unknown) => {
        if (active) setLoadError(loadMessage(failure));
      },
    );
    return () => {
      active = false;
    };
  }, [userId]);
  useFocusEffect(load);

  /** Runs one friend action, then shows the profile as the server now has it. */
  async function act(action: () => Promise<string | null>): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const success = await action();
      if (success) setNotice({ tone: "success", text: success });
    } catch (failure) {
      setNotice({ tone: "error", text: friendsErrorMessage(failure) });
    }
    try {
      setProfile(await profileApi.of(userId));
    } catch (failure) {
      setNotice({ tone: "error", text: loadMessage(failure) });
    } finally {
      setBusy(false);
    }
  }

  if (!profile) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center gap-4">
          {loadError ? (
            <>
              <Text tone="error" className="text-center" accessibilityRole="alert">
                {loadError}
              </Text>
              <Button title={copy.common.tryAgain} variant="secondary" onPress={load} />
            </>
          ) : (
            <ActivityIndicator color={colors.contentSecondary} />
          )}
        </View>
      </Screen>
    );
  }

  const friendState = friendStateOf(profile, myId);
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: profile.displayName }} />
      <View className="gap-8">
        <ProfileHeader
          displayName={profile.displayName}
          subtitle={<AboutLines profile={profile} />}
        >
          <FriendActions
            name={profile.displayName}
            state={friendState}
            busy={busy}
            onAdd={() =>
              act(async () => {
                // If they had already asked you, this makes you friends at once.
                const friendship = await friendsApi.send(userId);
                return friendship.status === "accepted" ? copy.friends.nowFriends : null;
              })
            }
            onCancelOrDecline={(requestId) =>
              act(async () => {
                await friendsApi.removeRequest(requestId);
                return null;
              })
            }
            onAccept={(requestId) =>
              act(async () => {
                await friendsApi.accept(requestId);
                return copy.friends.nowFriends;
              })
            }
            onUnfriend={() =>
              act(async () => {
                await friendsApi.unfriend(userId);
                return null;
              })
            }
          />
          {notice ? (
            <Text
              tone={notice.tone}
              className="text-center"
              accessibilityRole={notice.tone === "error" ? "alert" : undefined}
            >
              {notice.text}
            </Text>
          ) : null}
        </ProfileHeader>

        <ProfileBlocks profile={profile} withAbout={false} />
      </View>
    </Screen>
  );
}

/** Their full name, then their city, each only when the server sent it and it is filled in. */
function AboutLines({ profile }: { profile: Profile }) {
  const fullName = profile.friendsInfo?.fullName;
  const city = profile.friendsInfo?.city;
  return (
    <>
      {fullName ? (
        <Text tone="secondary" className="text-center">
          {fullName}
        </Text>
      ) : null}
      {city ? (
        <Text variant="caption" tone="secondary" className="text-center">
          {city}
        </Text>
      ) : null}
    </>
  );
}

/** The one action where you stand: add, cancel, accept or decline, or unfriend (asked twice). */
function FriendActions({
  name,
  state,
  busy,
  onAdd,
  onCancelOrDecline,
  onAccept,
  onUnfriend,
}: {
  name: string;
  state: FriendState;
  busy: boolean;
  onAdd: () => void;
  onCancelOrDecline: (requestId: string) => void;
  onAccept: (requestId: string) => void;
  onUnfriend: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const text = copy.friends;

  switch (state.kind) {
    case "self":
      return null;
    case "none":
      return <Button title={text.addFriend} fullWidth loading={busy} onPress={onAdd} />;
    case "sent":
      return (
        <Button
          title={text.cancelRequest}
          variant="secondary"
          fullWidth
          loading={busy}
          onPress={() => onCancelOrDecline(state.requestId)}
          accessibilityLabel={text.cancelRequestTo(name)}
        />
      );
    case "received":
      return (
        <View className="items-center gap-3 self-stretch">
          <Button
            title={text.accept}
            fullWidth
            loading={busy}
            onPress={() => onAccept(state.requestId)}
            accessibilityLabel={text.acceptFrom(name)}
          />
          <Button
            title={text.decline}
            variant="secondary"
            fullWidth
            disabled={busy}
            onPress={() => onCancelOrDecline(state.requestId)}
            accessibilityLabel={text.declineFrom(name)}
          />
        </View>
      );
    case "friends":
      // Unfriending takes away what each of you sees of the other, so it is asked twice.
      return confirming ? (
        <View className="items-center gap-3 self-stretch">
          <Text className="text-center">{text.unfriendConfirm(name)}</Text>
          <Button
            title={text.unfriend}
            variant="secondary"
            fullWidth
            loading={busy}
            onPress={() => {
              setConfirming(false);
              onUnfriend();
            }}
          />
          <Button
            title={text.keepFriend}
            variant="ghost"
            fullWidth
            disabled={busy}
            onPress={() => setConfirming(false)}
          />
        </View>
      ) : (
        <Button
          title={text.unfriend}
          variant="ghost"
          fullWidth
          disabled={busy}
          onPress={() => setConfirming(true)}
        />
      );
  }
}

/** A missing person (unknown id, or one that is not an id at all) is said as such. */
function loadMessage(failure: unknown): string {
  if (
    isRequestError(failure) &&
    (failure.code === "USER_NOT_FOUND" || failure.code === "VALIDATION_ERROR")
  ) {
    return copy.friends.notFound;
  }
  return profileErrorMessage(failure);
}
