import type { Plan } from "@music-room/shared";
import { Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useAuth } from "@/auth";
import { Badge, Button, Card, Icon, Screen, Text } from "@/components";
import { copy } from "@/copy";
import { isPremium, planErrorMessage, switchPlan } from "./plan";

// Plans (ADR-048): what Free and Premium include, which one you're on, and the switch. Payment is
// simulated, and the confirm step says so in plain words. After a switch the user is read again,
// so every screen follows (Create playlist, the playlist editor, rooms at the venue).
export default function PlanScreen() {
  const state = useAuth();
  const user = state.status === "signedIn" ? state.user : null;
  const current: Plan = isPremium(user) ? "premium" : "free";
  const target: Plan = current === "premium" ? "free" : "premium";
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const text = copy.plan;

  async function confirm(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await switchPlan(target);
      setConfirming(false);
      setNotice({
        tone: "success",
        text: target === "premium" ? text.upgraded : text.downgraded,
      });
    } catch (failure) {
      setNotice({ tone: "error", text: planErrorMessage(failure) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: text.title }} />
      <View className="gap-6">
        <Text tone="secondary">{text.current(text.names[current])}</Text>
        {(["free", "premium"] as const).map((plan) => (
          <Card key={plan} tone={plan === current ? "selected" : "low"} className="gap-3">
            <View className="flex-row items-center justify-between gap-3">
              <Text variant="h2">{text.names[plan]}</Text>
              {plan === current ? (
                <Badge label={text.currentLabel} tone="accent" />
              ) : null}
            </View>
            {text.includes[plan].map((line) => (
              <View key={line} className="flex-row items-start gap-2">
                <Icon name="check" tone="secondary" />
                <Text className="flex-1">{line}</Text>
              </View>
            ))}
          </Card>
        ))}

        {confirming ? (
          <View className="gap-3">
            <Text>{target === "premium" ? text.confirmUpgrade : text.confirmFree}</Text>
            <Button
              title={text.confirm}
              fullWidth
              loading={busy}
              onPress={() => void confirm()}
            />
            <Button
              title={text.cancel}
              variant="ghost"
              fullWidth
              disabled={busy}
              onPress={() => setConfirming(false)}
            />
          </View>
        ) : (
          <Button
            title={target === "premium" ? text.upgrade : text.switchToFree}
            variant={target === "premium" ? "primary" : "secondary"}
            fullWidth
            onPress={() => {
              setNotice(null);
              setConfirming(true);
            }}
          />
        )}
        {notice ? (
          <Text
            tone={notice.tone}
            accessibilityRole={notice.tone === "error" ? "alert" : undefined}
            accessibilityLiveRegion="polite"
          >
            {notice.text}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
