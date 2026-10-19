import type { ReactNode } from "react";
import { View } from "react-native";
import { Text } from "@/components";

/** The title block every auth screen starts with. */
export function ScreenTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: ReactNode;
}) {
  return (
    <View className="gap-2">
      <Text variant="h1">{title}</Text>
      {subtitle ? (
        <Text variant="bodyLarge" tone="secondary">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A message about the whole form. Errors are announced at once (alert); other messages politely,
 * when the screen reader is free.
 */
export function FormMessage({
  tone,
  children,
}: {
  tone: "error" | "success" | "secondary";
  children: ReactNode;
}) {
  return tone === "error" ? (
    <Text tone="error" accessibilityRole="alert">
      {children}
    </Text>
  ) : (
    <Text tone={tone} accessibilityLiveRegion="polite">
      {children}
    </Text>
  );
}
