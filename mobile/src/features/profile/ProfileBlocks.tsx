import type { Profile } from "@music-room/shared";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Card, Icon, type IconName, Text } from "@/components";
import { copy } from "@/copy";

// The blocks of a profile, each under a heading that says who can see it (ADR-024). Only the blocks
// the server sent are shown: a missing block is not empty, the caller may simply not see it, so
// nothing is drawn for it. Short values sit on the right of their label; the bio, which can be
// long, sits under it.
export function ProfileBlocks({ profile }: { profile: Profile }) {
  const { blocks, fields } = copy.profile;
  return (
    <View className="gap-6">
      <Section icon="public" {...blocks.public}>
        <Stacked label={fields.bio} value={profile.publicInfo.bio} />
      </Section>
      {profile.friendsInfo ? (
        <Section icon="friends" {...blocks.friends}>
          <Inline label={fields.fullName} value={profile.friendsInfo.fullName} />
          <Divider />
          <Inline label={fields.city} value={profile.friendsInfo.city} />
        </Section>
      ) : null}
      {profile.musicPreferences ? (
        <Section icon="music" {...blocks.music}>
          {profile.musicPreferences.genres.length > 0 ? (
            <View className="flex-row flex-wrap gap-2 py-1">
              {profile.musicPreferences.genres.map((genre) => (
                <View key={genre} className="rounded-full bg-surface-high px-3 py-1">
                  <Text variant="caption">{genre}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text tone="placeholder" className="py-1">
              {copy.profile.noGenres}
            </Text>
          )}
        </Section>
      ) : null}
      {profile.privateInfo ? (
        <Section icon="private" {...blocks.private}>
          <Inline label={fields.phone} value={profile.privateInfo.phone} />
          <Divider />
          <Inline label={fields.birthDate} value={profile.privateInfo.birthDate} />
        </Section>
      ) : null}
    </View>
  );
}

function Section({
  icon,
  title,
  audience,
  children,
}: {
  icon: IconName;
  title: string;
  audience: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-3">
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <Icon name={icon} size="h3" />
          <Text variant="h3">{title}</Text>
        </View>
        <Text variant="caption" tone="secondary">
          {audience}
        </Text>
      </View>
      <Card>{children}</Card>
    </View>
  );
}

/** Label on the left, value on the right: for short values. */
function Inline({ label, value }: { label: string; value: string | null }) {
  return (
    <View className="flex-row items-center justify-between gap-4 py-2">
      <Text tone="secondary">{label}</Text>
      <Value value={value} className="flex-shrink text-right" />
    </View>
  );
}

/** Label above, value below: for text that can run long. */
function Stacked({ label, value }: { label: string; value: string | null }) {
  return (
    <View className="gap-1 py-2">
      <Text tone="secondary">{label}</Text>
      <Value value={value} />
    </View>
  );
}

function Value({ value, className }: { value: string | null; className?: string }) {
  return value ? (
    <Text className={className}>{value}</Text>
  ) : (
    <Text tone="placeholder" className={className}>
      {copy.profile.notSet}
    </Text>
  );
}

function Divider() {
  return <View className="h-px bg-line-subtle" />;
}
