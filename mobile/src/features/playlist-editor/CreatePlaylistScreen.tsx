import { router, Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Button, ChoiceGroup, Input, Screen, Text } from "@/components";
import {
  createPlaylistRequestFrom,
  EMPTY_PLAYLIST_DRAFT,
  type CreatePlaylistDraft,
} from "./create-playlist-form";
import { playlistErrorMessage } from "./messages";
import { playlistApi } from "./playlist-api";
import { copy } from "@/copy";

const VISIBILITY = [
  { value: "public", label: copy.common.public },
  { value: "private", label: copy.common.private },
] as const;
const EDIT_MODES = [
  { value: "everyone", label: copy.createPlaylist.editChoices.everyone },
  { value: "invited_only", label: copy.createPlaylist.editChoices.invited_only },
] as const;

const VISIBILITY_HELP = copy.createPlaylist.visibilityHelp;
const EDIT_HELP = copy.createPlaylist.editHelp;

// Create a playlist (docs/api-contract.md, "Playlists"): name, who can see it, who may edit. The
// form checks the name before sending; the server checks everything again.
export default function CreatePlaylistScreen() {
  const [draft, setDraft] = useState<CreatePlaylistDraft>(EMPTY_PLAYLIST_DRAFT);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const change = (patch: Partial<CreatePlaylistDraft>) =>
    setDraft((d) => ({ ...d, ...patch }));

  async function create(): Promise<void> {
    const result = createPlaylistRequestFrom(draft);
    if (!result.ok) {
      setNameError(result.nameError);
      return;
    }
    setNameError(null);
    setFormError(null);
    setCreating(true);
    try {
      const playlist = await playlistApi.create(result.request);
      router.replace(`/playlist/${playlist.id}`);
    } catch (error) {
      setFormError(playlistErrorMessage(error));
      setCreating(false);
    }
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: copy.createPlaylist.title }} />
      <View className="gap-6">
        <Input
          label={copy.createPlaylist.nameLabel}
          placeholder={copy.createPlaylist.namePlaceholder}
          value={draft.name}
          onChangeText={(name) => change({ name })}
          error={nameError}
          maxLength={120}
          returnKeyType="done"
        />
        <ChoiceGroup
          label={copy.createPlaylist.visibilityLabel}
          options={VISIBILITY}
          value={draft.visibility}
          onChange={(visibility) => change({ visibility })}
          helper={VISIBILITY_HELP[draft.visibility]}
        />
        <ChoiceGroup
          label={copy.createPlaylist.editLabel}
          options={EDIT_MODES}
          value={draft.editMode}
          onChange={(editMode) => change({ editMode })}
          helper={EDIT_HELP[draft.editMode]}
        />
        {formError ? (
          <Text tone="error" accessibilityRole="alert">
            {formError}
          </Text>
        ) : null}
        <Button
          title={copy.createPlaylist.submit}
          fullWidth
          loading={creating}
          onPress={() => void create()}
        />
      </View>
    </Screen>
  );
}
