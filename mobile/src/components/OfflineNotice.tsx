import { View } from "react-native";
import { copy } from "@/copy";
import { useOnline } from "@/offline";
import { Icon } from "./Icon";
import { Text } from "./Text";

/** Offline mode (ADR-049): says the server cannot be reached; nothing while it can. */
export function OfflineNotice() {
  const online = useOnline();
  if (online) return null;
  return (
    <View
      className="flex-row items-center gap-2 rounded-lg bg-surface-high px-3 py-2"
      accessibilityRole="alert"
    >
      <Icon name="offline" tone="secondary" />
      <Text variant="caption" tone="secondary" className="flex-1">
        {copy.offline.offline}
      </Text>
    </View>
  );
}
