import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface ScreenProps {
  children: ReactNode;
  /** Scrolls when the content is taller than the screen (forms). Taps outside a field still work. */
  scroll?: boolean;
  /** Add the top safe-area inset. Not needed under a navigation header, which already handles it. */
  topInset?: boolean;
  /** Drawn behind everything, edge to edge (under the status bar too), e.g. a picture. Decorative. */
  background?: ReactNode;
}

/** The canvas every screen sits on (DESIGN.md rule 1), with the safe areas and the keyboard handled. */
export function Screen({
  children,
  scroll = false,
  topInset = false,
  background,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 bg-canvas"
      style={{ paddingTop: topInset ? insets.top : 0, paddingBottom: insets.bottom }}
    >
      {background ? (
        <View className="absolute inset-0" pointerEvents="none" accessible={false}>
          {background}
        </View>
      ) : null}
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerClassName="flex-grow px-5 py-6"
          >
            {children}
          </ScrollView>
        ) : (
          <View className="flex-1 px-5 py-6">{children}</View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}
