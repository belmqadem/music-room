import { router, Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Button, ChoiceGroup, Input, Screen, Text } from "@/components";
import { currentPosition } from "@/location/current-position";
import {
  createEventRequestFrom,
  DURATION_CHOICES_H,
  EMPTY_DRAFT,
  RADIUS_CHOICES_M,
  START_CHOICES_MIN,
  type CreateEventDraft,
  type DraftField,
} from "./create-event-form";
import { eventApi } from "./event-api";
import { trackVoteErrorMessage } from "./messages";
import { copy } from "@/copy";

const VISIBILITY = [
  { value: "public", label: copy.common.public },
  { value: "private", label: copy.common.private },
] as const;
const VOTE_MODES = [
  { value: "everyone", label: copy.createRoom.voteChoices.everyone },
  { value: "invited_only", label: copy.createRoom.voteChoices.invited_only },
  { value: "location_time", label: copy.createRoom.voteChoices.location_time },
] as const;
const RADIUS = RADIUS_CHOICES_M.map((m) => ({
  value: m,
  label: copy.createRoom.radius(m),
}));
const STARTS = START_CHOICES_MIN.map((min) => ({
  value: min,
  label: min === 0 ? copy.createRoom.opensNow : copy.createRoom.opensIn(min / 60),
}));
const DURATION = DURATION_CHOICES_H.map((h) => ({
  value: h,
  label: copy.createRoom.lasts(h),
}));

const VISIBILITY_HELP = copy.createRoom.visibilityHelp;
const VOTE_HELP = copy.createRoom.voteHelp;

// Create an event (docs/api-contract.md, "Events"): name, who can see it, who can vote. The form
// checks what it can before sending; the server checks everything again.
export default function CreateEventScreen() {
  const [draft, setDraft] = useState<CreateEventDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<Partial<Record<DraftField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [creating, setCreating] = useState(false);

  const change = (patch: Partial<CreateEventDraft>) =>
    setDraft((d) => ({ ...d, ...patch }));

  async function fillVenueFromMyPosition(): Promise<void> {
    setLocating(true);
    setFormError(null);
    try {
      const here = await currentPosition();
      change({
        latitude: here.latitude.toFixed(6),
        longitude: here.longitude.toFixed(6),
      });
      setErrors((e) => ({ ...e, latitude: undefined, longitude: undefined }));
    } catch (error) {
      setFormError(trackVoteErrorMessage(error));
    } finally {
      setLocating(false);
    }
  }

  async function create(): Promise<void> {
    const result = createEventRequestFrom(draft, new Date());
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setCreating(true);
    try {
      const event = await eventApi.create(result.request);
      router.replace(`/event/${event.id}`);
    } catch (error) {
      setFormError(trackVoteErrorMessage(error));
      setCreating(false);
    }
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: copy.createRoom.title }} />
      <View className="gap-6">
        <Input
          label={copy.createRoom.nameLabel}
          placeholder={copy.createRoom.namePlaceholder}
          value={draft.name}
          onChangeText={(name) => change({ name })}
          error={errors.name}
          maxLength={120}
          returnKeyType="done"
        />
        <ChoiceGroup
          label={copy.createRoom.visibilityLabel}
          options={VISIBILITY}
          value={draft.visibility}
          onChange={(visibility) => change({ visibility })}
          helper={VISIBILITY_HELP[draft.visibility]}
        />
        <ChoiceGroup
          label={copy.createRoom.voteLabel}
          options={VOTE_MODES}
          value={draft.mode}
          onChange={(mode) => change({ mode })}
          helper={VOTE_HELP[draft.mode]}
        />

        {draft.mode === "location_time" ? (
          <View className="gap-4">
            <Button
              title={copy.createRoom.useMyPosition}
              variant="secondary"
              fullWidth
              loading={locating}
              onPress={() => void fillVenueFromMyPosition()}
            />
            <Input
              label={copy.createRoom.latitudeLabel}
              placeholder="48.8966"
              value={draft.latitude}
              onChangeText={(latitude) => change({ latitude })}
              error={errors.latitude}
              keyboardType="numbers-and-punctuation"
            />
            <Input
              label={copy.createRoom.longitudeLabel}
              placeholder="2.3185"
              value={draft.longitude}
              onChangeText={(longitude) => change({ longitude })}
              error={errors.longitude}
              keyboardType="numbers-and-punctuation"
            />
            <ChoiceGroup
              label={copy.createRoom.radiusLabel}
              options={RADIUS}
              value={draft.radiusMeters}
              onChange={(radiusMeters) => change({ radiusMeters })}
            />
            <ChoiceGroup
              label={copy.createRoom.opensLabel}
              options={STARTS}
              value={draft.startsInMinutes}
              onChange={(startsInMinutes) => change({ startsInMinutes })}
            />
            <ChoiceGroup
              label={copy.createRoom.lastsLabel}
              options={DURATION}
              value={draft.durationHours}
              onChange={(durationHours) => change({ durationHours })}
            />
          </View>
        ) : null}

        {formError ? (
          <Text tone="error" accessibilityRole="alert">
            {formError}
          </Text>
        ) : null}
        <Button
          title={copy.createRoom.submit}
          fullWidth
          loading={creating}
          onPress={() => void create()}
        />
      </View>
    </Screen>
  );
}
