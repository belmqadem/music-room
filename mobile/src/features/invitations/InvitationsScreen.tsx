import type { UserSummary } from "@music-room/shared";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { peopleQueryFrom } from "@/api/search-query";
import { useLatestSearch } from "@/api/use-latest-search";
import { usersApi } from "@/api/users-api";
import { Badge, Button, Card, Input, Screen, Text } from "@/components";
import { colors } from "@/theme";
import type { InvitableResource } from "./invitations-api";
import { invitationErrorMessage } from "./messages";
import { useInvitations } from "./use-invitations";
import { copy } from "@/copy";

const isResource = (value: unknown): value is InvitableResource =>
  value === "event" || value === "playlist";

// The owner invites people to a private or invite-only event or playlist, and removes them.
// Invitations take effect at once: a removed person's live updates stop (event:access-lost).
export default function InvitationsScreen() {
  const { resource, id } = useLocalSearchParams<{ resource: string; id: string }>();
  if (!isResource(resource) || !id) {
    return (
      <Screen>
        <Text tone="secondary">{copy.common.notFoundPage}</Text>
      </Screen>
    );
  }
  return <Invitations resource={resource} id={id} />;
}

function Invitations({ resource, id }: { resource: InvitableResource; id: string }) {
  const invitations = useInvitations(resource, id);
  const people = useLatestSearch<UserSummary>(
    peopleQueryFrom,
    async (query) => (await usersApi.search(query)).items,
  );
  const [text, setText] = useState("");
  const { state } = people;

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: copy.invitations.title }} />
      <View className="gap-6">
        <Input
          label={copy.invitations.findLabel}
          placeholder={copy.invitations.findPlaceholder}
          value={text}
          onChangeText={(value) => {
            setText(value);
            people.input(value);
          }}
          autoCorrect={false}
          autoCapitalize="none"
        />

        {state.status === "searching" ? (
          <ActivityIndicator color={colors.contentSecondary} />
        ) : state.status === "failed" ? (
          <View className="gap-3">
            <Text tone="error" accessibilityRole="alert">
              {invitationErrorMessage(state.error)}
            </Text>
            <Button
              title={copy.common.tryAgain}
              variant="secondary"
              onPress={people.retry}
            />
          </View>
        ) : state.status === "done" ? (
          <View className="gap-3">
            {state.results.length === 0 ? (
              <Text tone="secondary">
                No one has a name starting with “{state.query}”.
              </Text>
            ) : (
              state.results.map((user) => (
                <PersonRow key={user.id} user={user}>
                  {invitations.invited.has(user.id) ? (
                    <Badge label={copy.invitations.invited} />
                  ) : (
                    <Button
                      title={copy.invitations.invite}
                      variant="secondary"
                      loading={invitations.busyUserId === user.id}
                      disabled={invitations.busyUserId !== null}
                      onPress={() => void invitations.invite(user)}
                      accessibilityLabel={copy.invitations.inviteName(user.displayName)}
                    />
                  )}
                </PersonRow>
              ))
            )}
          </View>
        ) : null}

        {invitations.actionError ? (
          <Text tone="error" accessibilityRole="alert">
            {invitations.actionError}
          </Text>
        ) : null}

        <View className="gap-3">
          <Text variant="h3">
            {copy.invitations.invitedCount(invitations.invitations.length)}
          </Text>
          {invitations.loading ? (
            <ActivityIndicator color={colors.contentSecondary} />
          ) : invitations.loadError ? (
            <Text tone="error" accessibilityRole="alert">
              {invitations.loadError}
            </Text>
          ) : invitations.invitations.length === 0 ? (
            <Text tone="secondary">{copy.invitations.empty}</Text>
          ) : (
            invitations.invitations.map(({ user }) => (
              <PersonRow key={user.id} user={user}>
                <Button
                  title={copy.invitations.remove}
                  variant="ghost"
                  loading={invitations.busyUserId === user.id}
                  disabled={invitations.busyUserId !== null}
                  onPress={() => void invitations.remove(user.id)}
                  accessibilityLabel={copy.invitations.removeName(user.displayName)}
                />
              </PersonRow>
            ))
          )}
          {invitations.hasMore ? (
            <Button
              title={copy.common.showMore}
              variant="ghost"
              onPress={() => void invitations.loadMore()}
            />
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

/** Names are not unique: the start of the id tells two people with the same name apart. */
function PersonRow({ user, children }: { user: UserSummary; children: React.ReactNode }) {
  return (
    <Card className="flex-row items-center gap-3">
      <View className="flex-1 gap-1">
        <Text variant="h3" numberOfLines={1}>
          {user.displayName}
        </Text>
        <Text variant="caption" tone="secondary">
          #{user.id.slice(0, 8)}
        </Text>
      </View>
      {children}
    </Card>
  );
}
