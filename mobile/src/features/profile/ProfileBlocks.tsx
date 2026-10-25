import type { Profile } from "@music-room/shared";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Badge, Card, Text } from "@/components";
import { copy } from "@/copy";

// The blocks of a profile, each with who can see it (ADR-024). Only the blocks the server sent are
// shown: a missing block is not empty, the caller may simply not see it, so nothing is drawn for it.
export function ProfileBlocks({ profile }: { profile: Profile }) {
  const { blocks, fields } = copy.profile;
  return (
    <View className="gap-4">
      <Block title={blocks.public.title} audience={blocks.public.audience}>
        <Field label={fields.bio} value={profile.publicInfo.bio} />
      </Block>
      {profile.friendsInfo ? (
        <Block title={blocks.friends.title} audience={blocks.friends.audience}>
          <Field label={fields.fullName} value={profile.friendsInfo.fullName} />
          <Field label={fields.city} value={profile.friendsInfo.city} />
        </Block>
      ) : null}
      {profile.musicPreferences ? (
        <Block title={blocks.music.title} audience={blocks.music.audience}>
          {profile.musicPreferences.genres.length > 0 ? (
            <View className="flex-row flex-wrap gap-2">
              {profile.musicPreferences.genres.map((genre) => (
                <Badge key={genre} label={genre} />
              ))}
            </View>
          ) : (
            <Text tone="placeholder">{copy.profile.noGenres}</Text>
          )}
        </Block>
      ) : null}
      {profile.privateInfo ? (
        <Block title={blocks.private.title} audience={blocks.private.audience}>
          <Field label={fields.phone} value={profile.privateInfo.phone} />
          <Field label={fields.birthDate} value={profile.privateInfo.birthDate} />
        </Block>
      ) : null}
    </View>
  );
}

function Block({
  title,
  audience,
  children,
}: {
  title: string;
  audience: string;
  children: ReactNode;
}) {
  return (
    <Card className="gap-3">
      <View className="gap-1">
        <Text variant="h3">{title}</Text>
        <Text variant="caption" tone="secondary">
          {audience}
        </Text>
      </View>
      {children}
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <View className="gap-1">
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      {value ? (
        <Text>{value}</Text>
      ) : (
        <Text tone="placeholder">{copy.profile.notSet}</Text>
      )}
    </View>
  );
}
