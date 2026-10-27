import { View } from "react-native";
import { copy } from "@/copy";
import { useOnline } from "@/offline";
import { Icon } from "./Icon";
import { Text } from "./Text";

/** "14:32", in the phone's own format. */
export const timeOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Offline mode (ADR-049): says that the server cannot be reached and, when the screen shows an
 * offline copy, from when. Nothing when online and showing the server's data.
 */
export function OfflineNotice({
  cachedAt = null,
  pending = 0,
}: {
  /** When the copy on screen was saved; null when it is the server's. */
  cachedAt?: string | null;
  /** Changes made offline, waiting for the server. */
  pending?: number;
}) {
  const online = useOnline();
  if (online && cachedAt === null && pending === 0) return null;
  return (
    <View
      className="flex-row items-start gap-2 rounded-lg bg-surface-high px-3 py-2"
      accessibilityRole="alert"
    >
      <Icon name="offline" tone="secondary" />
      <View className="flex-1 gap-1">
        <Text variant="caption" tone="secondary">
          {copy.offline.offline}
        </Text>
        {pending > 0 ? (
          <Text variant="caption" tone="secondary">
            {copy.offline.pending(pending)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
