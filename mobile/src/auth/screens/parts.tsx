import type { ReactNode } from "react";
import { Image, View } from "react-native";
import { Text } from "@/components";

// The picture behind the first screens (Welcome, Pick your username). Replace the file, same name
// and format (JPEG: a photo, so a few hundred KB rather than megabytes), to change it; a tall, dark
// photo works best.
const BRAND_PICTURE = require("../../../assets/images/welcome-background.jpg");
const FILL = { width: "100%", height: "100%" } as const;

/**
 * The brand picture, for a Screen's `background`: at 40% over the canvas, so the text on it stays
 * readable. Only on the screens that are about arriving, not on forms (inputs and their errors
 * need the plain canvas). `faint` (20%) is for a screen whose text sits over the busy top of the
 * picture, like Pick your username.
 */
export function BrandBackground({ faint = false }: { faint?: boolean }) {
  return (
    // The size sits on a View that clips: on the web an image's own size (940 x 1672) beats its
    // className, so the picture overflowed the app's column (ADR-050).
    <View
      className={`h-full w-full overflow-hidden ${faint ? "opacity-20" : "opacity-40"}`}
    >
      <Image source={BRAND_PICTURE} style={FILL} resizeMode="cover" accessible={false} />
    </View>
  );
}

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
