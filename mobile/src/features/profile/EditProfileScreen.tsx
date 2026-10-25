import { router, Stack } from "expo-router";
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
  type ProfileDraft,
  type ProfileField,
  profileUpdateFrom,
  todayUtc,
} from "./profile-form";

// Edit your profile (docs/api-contract.md, "Profiles"; ADR-024). The form starts from the server's
// copy, checks what the server checks, and sends only what changed; nothing changed, nothing sent.
// Each group says who will see it, in the same words as the profile tab.
export default function EditProfileScreen() {
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
        <Stack.Screen options={{ title: copy.editProfile.title }} />
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
  return (
    <Screen scroll>
      <Stack.Screen options={{ title: text.title }} />
      <View className="gap-8">
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
