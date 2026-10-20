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

const VISIBILITY = [
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
] as const;
const VOTE_MODES = [
  { value: "everyone", label: "Everyone" },
  { value: "invited_only", label: "Invited people" },
  { value: "location_time", label: "At the venue" },
] as const;
const RADIUS = RADIUS_CHOICES_M.map((m) => ({ value: m, label: `${m} m` }));
const STARTS = START_CHOICES_MIN.map((min) => ({
  value: min,
  label: min === 0 ? "Now" : `In ${min / 60} h`,
}));
const DURATION = DURATION_CHOICES_H.map((h) => ({ value: h, label: `${h} h` }));

const VISIBILITY_HELP = {
  public: "Listed for everyone.",
  private: "Only you and the people you invite can find it.",
} as const;
const VOTE_HELP = {
  everyone: "Anyone who can see the event can vote and suggest tracks.",
  invited_only: "Everyone who can see it follows along; only invited people vote.",
  location_time:
    "People vote only near the venue, while the event runs. You, the owner, can always vote.",
} as const;

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
      <Stack.Screen options={{ title: "Create an event" }} />
      <View className="gap-6">
        <Input
          label="Name"
          placeholder="Friday night"
          value={draft.name}
          onChangeText={(name) => change({ name })}
          error={errors.name}
          maxLength={120}
          returnKeyType="done"
        />
        <ChoiceGroup
          label="Who can see it"
          options={VISIBILITY}
          value={draft.visibility}
          onChange={(visibility) => change({ visibility })}
          helper={VISIBILITY_HELP[draft.visibility]}
        />
        <ChoiceGroup
          label="Who can vote"
          options={VOTE_MODES}
          value={draft.mode}
          onChange={(mode) => change({ mode })}
          helper={VOTE_HELP[draft.mode]}
        />

        {draft.mode === "location_time" ? (
          <View className="gap-4">
            <Button
              title="Use my current position"
              variant="secondary"
              fullWidth
              loading={locating}
              onPress={() => void fillVenueFromMyPosition()}
            />
            <Input
              label="Venue latitude"
              placeholder="48.8966"
              value={draft.latitude}
              onChangeText={(latitude) => change({ latitude })}
              error={errors.latitude}
              keyboardType="numbers-and-punctuation"
            />
            <Input
              label="Venue longitude"
              placeholder="2.3185"
              value={draft.longitude}
              onChangeText={(longitude) => change({ longitude })}
              error={errors.longitude}
              keyboardType="numbers-and-punctuation"
            />
            <ChoiceGroup
              label="Votes count within"
              options={RADIUS}
              value={draft.radiusMeters}
              onChange={(radiusMeters) => change({ radiusMeters })}
            />
            <ChoiceGroup
              label="Voting opens"
              options={STARTS}
              value={draft.startsInMinutes}
              onChange={(startsInMinutes) => change({ startsInMinutes })}
            />
            <ChoiceGroup
              label="Voting lasts"
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
          title="Create event"
          fullWidth
          loading={creating}
          onPress={() => void create()}
        />
      </View>
    </Screen>
  );
}
