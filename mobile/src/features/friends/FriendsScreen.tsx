import type { Friendship, UserSummary } from "@music-room/shared";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { peopleQueryFrom } from "@/api/search-query";
import { usePagedList } from "@/api/use-paged-list";
import { useLatestSearch } from "@/api/use-latest-search";
import { usersApi } from "@/api/users-api";
import { Button, Input, PersonRow, Screen, Text } from "@/components";
import { copy } from "@/copy";
import { colors } from "@/theme";
import { friendsApi } from "./friends-api";
import { friendsErrorMessage } from "./messages";

// Friends (docs/api-contract.md, "Friends"; ADR-023): find people, the requests you received and
// sent, and your friends. Each list is read again when the screen shows (requests are not pushed
// live yet, so this is how a new one appears) and after every action, so the server's state is
// what shows. A person opens their profile, where the same actions are.

// Module-level so the paged lists fetch on focus only (usePagedList).
const incomingPage = (cursor?: string) => friendsApi.requests("incoming", cursor);
const outgoingPage = (cursor?: string) => friendsApi.requests("outgoing", cursor);
const friendsPage = (cursor?: string) => friendsApi.friends(cursor);

const openProfile = (user: UserSummary) => router.push(`/person/${user.id}`);

export default function FriendsScreen() {
  const incoming = usePagedList(incomingPage, friendsErrorMessage);
  const outgoing = usePagedList(outgoingPage, friendsErrorMessage);
  const friends = usePagedList(friendsPage, friendsErrorMessage);
  const people = useLatestSearch<UserSummary>(
    peopleQueryFrom,
    async (query) => (await usersApi.search(query)).items,
  );
  const [text, setText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const t = copy.friends;

  /** One action on a request, then every list again: accepting moves someone to your friends. */
  async function act(requestId: string, action: () => Promise<unknown>): Promise<void> {
    setBusyId(requestId);
    setActionError(null);
    try {
      await action();
    } catch (failure) {
      setActionError(friendsErrorMessage(failure));
    }
    await Promise.all([incoming.refresh(), outgoing.refresh(), friends.refresh()]);
    setBusyId(null);
  }

  const searching = people.state.status !== "idle";
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: t.title }} />
      <View className="gap-8">
        <View className="gap-3">
          <Input
            label={copy.common.findPeople}
            placeholder={copy.common.findPeoplePlaceholder}
            value={text}
            onChangeText={(value) => {
              setText(value);
              people.input(value);
            }}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {people.state.status === "searching" ? (
            <ActivityIndicator color={colors.contentSecondary} />
          ) : people.state.status === "failed" ? (
            <View className="gap-3">
              <Text tone="error" accessibilityRole="alert">
                {friendsErrorMessage(people.state.error)}
              </Text>
              <Button
                title={copy.common.tryAgain}
                variant="secondary"
                onPress={people.retry}
              />
            </View>
          ) : people.state.status === "done" ? (
            people.state.results.length === 0 ? (
              <Text tone="secondary">
                {copy.common.noPeopleMatch(people.state.query)}
              </Text>
            ) : (
              people.state.results.map((user) => (
                <PersonRow
                  key={user.id}
                  user={user}
                  onPress={() => openProfile(user)}
                  accessibilityLabel={t.open(user.displayName)}
                />
              ))
            )
          ) : null}
        </View>

        {searching ? null : (
          <>
            {actionError ? (
              <Text tone="error" accessibilityRole="alert">
                {actionError}
              </Text>
            ) : null}

            <Section
              title={t.requests}
              list={incoming}
              hideWhenEmpty
              row={(request) => (
                <PersonRow
                  key={request.id}
                  user={request.user}
                  onPress={() => openProfile(request.user)}
                  accessibilityLabel={t.open(request.user.displayName)}
                  actionsBelow
                >
                  <View className="flex-1">
                    <Button
                      title={t.accept}
                      variant="secondary"
                      fullWidth
                      loading={busyId === request.id}
                      disabled={busyId !== null}
                      onPress={() =>
                        void act(request.id, () => friendsApi.accept(request.id))
                      }
                      accessibilityLabel={t.acceptFrom(request.user.displayName)}
                    />
                  </View>
                  <View className="flex-1">
                    <Button
                      title={t.decline}
                      variant="ghost"
                      fullWidth
                      disabled={busyId !== null}
                      onPress={() =>
                        void act(request.id, () => friendsApi.removeRequest(request.id))
                      }
                      accessibilityLabel={t.declineFrom(request.user.displayName)}
                    />
                  </View>
                </PersonRow>
              )}
            />

            <Section
              title={t.sent}
              list={outgoing}
              hideWhenEmpty
              row={(request) => (
                <PersonRow
                  key={request.id}
                  user={request.user}
                  onPress={() => openProfile(request.user)}
                  accessibilityLabel={t.open(request.user.displayName)}
                  actionsBelow
                >
                  <View className="flex-1">
                    <Button
                      title={t.cancelRequest}
                      variant="ghost"
                      fullWidth
                      loading={busyId === request.id}
                      disabled={busyId !== null}
                      onPress={() =>
                        void act(request.id, () => friendsApi.removeRequest(request.id))
                      }
                      accessibilityLabel={t.cancelRequestTo(request.user.displayName)}
                    />
                  </View>
                </PersonRow>
              )}
            />

            <Section
              title={t.yourFriends}
              list={friends}
              empty={t.noFriends}
              row={(friendship) => (
                <PersonRow
                  key={friendship.id}
                  user={friendship.user}
                  onPress={() => openProfile(friendship.user)}
                  accessibilityLabel={t.open(friendship.user.displayName)}
                />
              )}
            />
          </>
        )}
      </View>
    </Screen>
  );
}

/** A heading and one paged list, with its loading, error, empty and Show more states. */
function Section({
  title,
  list,
  row,
  empty,
  hideWhenEmpty = false,
}: {
  title: string;
  list: ReturnType<typeof usePagedList<Friendship>>;
  row: (friendship: Friendship) => React.ReactNode;
  empty?: string;
  /** Requests: no section at all when there are none, rather than an empty heading. */
  hideWhenEmpty?: boolean;
}) {
  if (hideWhenEmpty && !list.loading && !list.error && list.items.length === 0)
    return null;
  return (
    <View className="gap-3">
      <Text variant="h3">{title}</Text>
      {list.loading ? (
        <ActivityIndicator color={colors.contentSecondary} />
      ) : list.error ? (
        <View className="gap-3">
          <Text tone="error" accessibilityRole="alert">
            {list.error}
          </Text>
          <Button
            title={copy.common.tryAgain}
            variant="secondary"
            onPress={() => void list.refresh()}
          />
        </View>
      ) : list.items.length === 0 ? (
        <Text tone="secondary">{empty}</Text>
      ) : (
        list.items.map(row)
      )}
      {list.hasMore ? (
        <Button
          title={copy.common.showMore}
          variant="ghost"
          onPress={() => void list.loadMore()}
        />
      ) : null}
    </View>
  );
}
