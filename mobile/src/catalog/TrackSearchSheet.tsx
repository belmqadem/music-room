import type { Track } from "@music-room/shared";
import { useState } from "react";
import { ActivityIndicator, FlatList, Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTrackSearch } from "@/api/use-track-search";
import { Button, Input, Text, TrackPickRow } from "@/components";
import { colors } from "@/theme";

export interface TrackSearchSheetProps {
  visible: boolean;
  /** "Suggest a track", "Add a track", ... */
  title: string;
  /** The button on each result: "Add". */
  actionLabel: string;
  onClose: () => void;
  /** Use the picked track; an error message, or null when it worked (the sheet then closes). */
  onPick: (track: Track) => Promise<string | null>;
  /** The words for a failed search (the feature's own messages). */
  searchErrorMessage: (error: unknown) => string;
}

// Search the catalog and pick a track, in a sheet over the screen that uses it (Track Vote: suggest;
// Playlist Editor: add). A sheet rather than a screen of its own, so the screen underneath records
// the server's answer itself (for a suggestion, that it counts as my vote).
export function TrackSearchSheet({ visible, ...content }: TrackSearchSheetProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={content.onClose}
    >
      {/* Mounted only while open: each opening starts with an empty search. */}
      {visible ? <SheetContent {...content} /> : null}
    </Modal>
  );
}

function SheetContent({
  title,
  actionLabel,
  onClose,
  onPick,
  searchErrorMessage,
}: Omit<TrackSearchSheetProps, "visible">) {
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
        <Text variant="h2">{title}</Text>
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
            {searchErrorMessage(state.error)}
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
              actionLabel={actionLabel}
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
