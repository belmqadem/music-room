import { router, Stack, useLocalSearchParams } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Button, Input, Screen, Text } from "@/components";
import { copy } from "@/copy";
import { colors } from "@/theme";
import { profileErrorMessage } from "./messages";
import { profileApi } from "./profile-api";
import {
  BIO_MAX_LENGTH,
  draftFromProfile,
  NAME_MAX_LENGTH,
  PROFILE_SECTIONS,
  type ProfileDraft,
  type ProfileField,
  profileUpdateFrom,
  sectionFrom,
  todayUtc,
} from "./profile-form";

const ALL_FIELDS = Object.values(PROFILE_SECTIONS).flat();

// Edit one section of your profile (docs/api-contract.md, "Profiles"; ADR-024), the one whose edit
// button opened it (`?section=`); the whole profile when the route names none. The form starts
// from the server's copy, checks what the server checks, and sends only what changed; nothing
// changed, nothing sent. Each group says exactly who will see it, in the tiers' own words.
export default function EditProfileScreen() {
  const section = sectionFrom(useLocalSearchParams<{ section?: string }>().section);
  const shown: readonly ProfileField[] = section ? PROFILE_SECTIONS[section] : ALL_FIELDS;
  const title = section ? copy.editProfile.titles[section] : copy.editProfile.title;
  const [original, setOriginal] = useState<ProfileDraft | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ProfileField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    profileApi.mine().then(
      (profile) => {
        if (!active) return;
        const loaded = draftFromProfile(profile);
        setOriginal(loaded);
        setDraft(loaded);
      },
      (failure: unknown) => {
        if (active) setLoadError(profileErrorMessage(failure));
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const change = (field: ProfileField) => (value: string) => {
    setDraft((d) => (d ? { ...d, [field]: value } : d));
    setErrors(({ [field]: _fixed, ...rest }) => rest);
  };

  async function save(): Promise<void> {
    if (!draft || !original) return;
    const result = profileUpdateFrom(draft, original, todayUtc());
    if (!result.ok) {
      setErrors(result.errors);
      // A field of another section only ever holds what the server accepted, under the same
      // rules, so this should not happen; if it does, say which field rather than fail silently.
      const elsewhere = Object.entries(result.errors).filter(
        ([field]) => !shown.includes(field as ProfileField),
      );
      setFormError(
        elsewhere.length > 0
          ? elsewhere
              .map(
                ([field, message]) =>
                  `${copy.profile.fields[field as ProfileField]}: ${message}`,
              )
              .join(" ")
          : null,
      );
      return;
    }
    if (Object.keys(result.request).length === 0) {
      router.back();
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      await profileApi.update(result.request);
      router.back();
    } catch (error) {
      setFormError(profileErrorMessage(error));
      setSaving(false);
    }
  }

  if (!draft) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <View className="flex-1 items-center justify-center gap-4">
          {loadError ? (
            <Text tone="error" className="text-center" accessibilityRole="alert">
              {copy.profile.loadFailed} {loadError}
            </Text>
          ) : (
            <ActivityIndicator color={colors.contentSecondary} />
          )}
        </View>
      </Screen>
    );
  }

  const { blocks, fields } = copy.profile;
  const text = copy.editProfile;
  const show = (field: ProfileField) => shown.includes(field);
  return (
    <Screen scroll>
      <Stack.Screen options={{ title }} />
      <View className="gap-8">
        {show("bio") ? (
          <Group title={blocks.public.title} audience={blocks.public.audience}>
            <Input
              label={fields.bio}
              placeholder={text.bioPlaceholder}
              value={draft.bio}
              onChangeText={change("bio")}
              error={errors.bio}
              multiline
              maxLength={BIO_MAX_LENGTH + 20}
            />
          </Group>
        ) : null}

        {show("fullName") ? (
          <Group title={blocks.friends.title} audience={blocks.friends.audience}>
            <Input
              label={fields.fullName}
              placeholder={text.fullNamePlaceholder}
              value={draft.fullName}
              onChangeText={change("fullName")}
              error={errors.fullName}
              autoComplete="name"
              maxLength={NAME_MAX_LENGTH + 20}
            />
            <Input
              label={fields.city}
              placeholder={text.cityPlaceholder}
              value={draft.city}
              onChangeText={change("city")}
              error={errors.city}
              maxLength={NAME_MAX_LENGTH + 20}
            />
          </Group>
        ) : null}

        {show("phone") ? (
          <Group title={blocks.private.title} audience={blocks.private.audience}>
            <Input
              label={fields.phone}
              placeholder={text.phonePlaceholder}
              value={draft.phone}
              onChangeText={change("phone")}
              error={errors.phone}
              keyboardType="phone-pad"
              autoComplete="tel"
            />
            <Input
              label={fields.birthDate}
              placeholder={text.birthDatePlaceholder}
              value={draft.birthDate}
              onChangeText={change("birthDate")}
              error={errors.birthDate}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
          </Group>
        ) : null}

        {show("genres") ? (
          <Group title={blocks.music.title} audience={blocks.music.audience}>
            <Input
              label={fields.genres}
              placeholder={text.genresPlaceholder}
              value={draft.genres}
              onChangeText={change("genres")}
              error={errors.genres}
              helper={text.genresHelper}
              autoCapitalize="none"
            />
          </Group>
        ) : null}

        {formError ? (
          <Text tone="error" accessibilityRole="alert">
            {formError}
          </Text>
        ) : null}
        <Button
          title={text.save}
          fullWidth
          loading={saving}
          onPress={() => void save()}
        />
      </View>
    </Screen>
  );
}

function Group({
  title,
  audience,
  children,
}: {
  title: string;
  audience: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-4">
      <View className="gap-1">
        <Text variant="h3">{title}</Text>
        <Text variant="caption" tone="secondary">
          {audience}
        </Text>
      </View>
      {children}
    </View>
  );
}
