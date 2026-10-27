import { useSyncExternalStore } from "react";
import { View } from "react-native";
import { Button, Card, Text } from "@/components";
import { copy } from "@/copy";
import { playlistOutbox } from "./offline-edits";

/**
 * After offline changes were sent (ADR-049): how many the server took, and each one it did not,
 * with why. Shown until closed, on whichever playlist screen is open.
 */
export function SyncSummaryNotice() {
  const summary = useSyncExternalStore(playlistOutbox.subscribe, playlistOutbox.summary);
  if (!summary) return null;
  return (
    <Card className="gap-2" accessibilityLiveRegion="polite">
      {summary.synced > 0 ? (
        <Text variant="caption" tone="success">
          {copy.offline.synced(summary.synced)}
        </Text>
      ) : null}
      {summary.dropped.map((dropped, index) => (
        <Text key={index} variant="caption" tone="warning">
          {copy.offline.dropped[dropped.reason](dropped.trackTitle)}
        </Text>
      ))}
      <View className="items-start">
        <Button
          title={copy.common.close}
          variant="ghost"
          onPress={() => playlistOutbox.dismissSummary()}
        />
      </View>
    </Card>
  );
}
