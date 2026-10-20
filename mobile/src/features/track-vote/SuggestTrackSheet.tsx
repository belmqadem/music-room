import type { Track } from "@music-room/shared";
import { useState } from "react";
import { ActivityIndicator, FlatList, Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTrackSearch } from "@/api/use-track-search";
import { Button, Input, Text, TrackPickRow } from "@/components";
import { colors } from "@/theme";
import { trackVoteErrorMessage } from "./messages";

export interface SuggestTrackSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Suggest the picked track; an error message, or null when it worked (the sheet then closes). */
  onPick: (track: Track) => Promise<string | null>;
}

// Search the catalog and suggest a track. A sheet over the event screen rather than a screen of its
// own: the suggestion counts as my vote, and the event screen's queue must record that answer.
export function SuggestTrackSheet({ visible, onClose, onPick }: SuggestTrackSheetProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {/* Mounted only while open: each opening starts with an empty search. */}
      {visible ? <SheetContent onClose={onClose} onPick={onPick} /> : null}
    </Modal>
  );
}

function SheetContent({ onClose, onPick }: Omit<SuggestTrackSheetProps, "visible">) {
  const insets = useSafeAreaInsets();
  const search = useTrackSearch();
  const [text, setText] = useState("");
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  async function pick(track: Track): Promise<void> {
    setPickingId(track.providerTrackId);
    setPickError(null);
    const error = await onPick(track);
    setPickingId(null);
    if (error) setPickError(error);
    else onClose();
  }

  const { state } = search;
  return (
    <View
      className="flex-1 gap-4 bg-canvas px-5 pt-6"
      style={{ paddingBottom: insets.bottom }}
    >
      <View className="flex-row items-center justify-between">
        <Text variant="h2">Suggest a track</Text>
        <Button title="Close" variant="ghost" onPress={onClose} />
      </View>
      <Input
        label="Search the catalog"
        placeholder="Artist or title"
        value={text}
        onChangeText={(value) => {
          setText(value);
          search.input(value);
        }}
        autoFocus
        autoCorrect={false}
        returnKeyType="search"
      />
      {pickError ? (
        <Text tone="error" accessibilityRole="alert">
          {pickError}
        </Text>
      ) : null}

      {state.status === "idle" ? (
        <Text tone="secondary">Type at least 2 characters.</Text>
      ) : state.status === "searching" ? (
        <ActivityIndicator color={colors.contentSecondary} />
      ) : state.status === "failed" ? (
        <View className="gap-3">
          <Text tone="error" accessibilityRole="alert">
            {trackVoteErrorMessage(state.error)}
          </Text>
          <Button title="Try again" variant="secondary" onPress={search.retry} />
        </View>
      ) : (
        <FlatList
          className="flex-1"
          contentContainerClassName="gap-3 pb-6"
          keyboardShouldPersistTaps="handled"
          data={state.results}
          keyExtractor={(track) => track.providerTrackId}
          renderItem={({ item }) => (
            <TrackPickRow
              track={item}
              actionLabel="Add"
              busy={pickingId === item.providerTrackId}
              disabled={pickingId !== null && pickingId !== item.providerTrackId}
              onPick={() => void pick(item)}
            />
          )}
          ListEmptyComponent={
            <Text tone="secondary">No tracks found for “{state.query}”.</Text>
          }
        />
      )}
    </View>
  );
}
