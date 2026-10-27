import type { Profile } from "@music-room/shared";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Card, Icon, IconButton, type IconName, Text } from "@/components";
import { copy } from "@/copy";
import type { ProfileSection } from "./profile-form";

// The blocks of a profile (ADR-024), named after what they hold rather than who can see them; that
// is spelled out on Edit profile, where you choose what to share. About gathers two blocks (the
// friends-only full name and city, the private phone and birth date). Only the blocks the server
// sent are shown: a missing block is not empty, the caller may simply not see it, so nothing is
// drawn for it (and no About at all when neither came). Short values sit on the right of their
// label. With `onEdit` (only ever your own profile), each section has its own edit button and is
// named in your words ("About me"). Someone else's profile shows their About under their name
// instead (`withAbout={false}`).
export function ProfileBlocks({
  profile,
  onEdit,
  withAbout = true,
}: {
  profile: Profile;
  onEdit?: (section: ProfileSection) => void;
  withAbout?: boolean;
}) {
  const { fields } = copy.profile;
  const headings = onEdit ? copy.profile.headings.mine : copy.profile.headings.theirs;
  const editOf = (section: ProfileSection) =>
    onEdit ? () => onEdit(section) : undefined;
  return (
    <View className="gap-6">
      <Section
        icon="bio"
        title={headings.bio}
        editLabel={copy.editProfile.titles.bio}
        onEdit={editOf("bio")}
      >
        <Value value={profile.publicInfo.bio} className="py-2" />
      </Section>
      {withAbout && (profile.friendsInfo || profile.privateInfo) ? (
        <Section
          icon="about"
          title={headings.about}
          editLabel={copy.editProfile.titles.about}
          onEdit={editOf("about")}
        >
          {profile.friendsInfo ? (
            <>
              <Inline label={fields.fullName} value={profile.friendsInfo.fullName} />
              <Divider />
              <Inline label={fields.city} value={profile.friendsInfo.city} />
            </>
          ) : null}
          {profile.friendsInfo && profile.privateInfo ? <Divider /> : null}
          {profile.privateInfo ? (
            <>
              <Inline label={fields.phone} value={profile.privateInfo.phone} />
              <Divider />
              <Inline label={fields.birthDate} value={profile.privateInfo.birthDate} />
            </>
          ) : null}
        </Section>
      ) : null}
      {profile.musicPreferences ? (
        <Section
          icon="music"
          title={headings.music}
          editLabel={copy.editProfile.titles.music}
          onEdit={editOf("music")}
        >
          {profile.musicPreferences.genres.length > 0 ? (
            <View className="flex-row flex-wrap gap-2 py-1">
              {profile.musicPreferences.genres.map((genre) => (
                <GenreChip key={genre} genre={genre} />
              ))}
            </View>
          ) : (
            <Text tone="placeholder" className="py-1">
              {copy.profile.noGenres}
            </Text>
          )}
        </Section>
      ) : null}
    </View>
  );
}

function Section({
  icon,
  title,
  editLabel,
  onEdit,
  children,
}: {
  icon: IconName;
  title: string;
  editLabel: string;
  /** Absent when the profile is someone else's: no edit button then. */
  onEdit?: () => void;
  children: ReactNode;
}) {
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2">
        <Icon name={icon} size="h3" />
        <Text variant="h3" className="flex-1">
          {title}
        </Text>
        {onEdit ? (
          <IconButton icon="edit" accessibilityLabel={editLabel} onPress={onEdit} />
        ) : null}
      </View>
      <Card>{children}</Card>
    </View>
  );
}

/**
 * A genre as a record: a small disc (dark vinyl, one groove, a lighter label and the spindle hole,
 * all surface tiers and the hairline) on the left of the name. Decorative: the name is what is read.
 */
function GenreChip({ genre }: { genre: string }) {
  return (
    <View className="flex-row items-center gap-2 rounded-full border border-line-subtle bg-surface-high py-1 pl-1 pr-3">
      <View
        className="h-7 w-7 items-center justify-center rounded-full border border-line-subtle bg-surface-lowest"
        accessible={false}
      >
        <View className="h-5 w-5 items-center justify-center rounded-full border border-line-subtle">
          <View className="h-2.5 w-2.5 items-center justify-center rounded-full bg-surface-bright">
            <View className="h-1 w-1 rounded-full bg-canvas" />
          </View>
        </View>
      </View>
      <Text>{genre}</Text>
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
