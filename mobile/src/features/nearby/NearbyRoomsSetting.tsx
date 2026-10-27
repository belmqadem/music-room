import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { Button, Card, Switch, Text } from "@/components";
import { copy } from "@/copy";
import { enableProblemMessage, needsPhoneSettings } from "./messages";
import { enableNearby, nearbySupported, nearbyWatcher } from "./nearby-native";

// Settings, "Rooms near you" (ADR-052): off until you turn it on. Turning it on asks for location
// all the time and for notifications, says plainly why, and stays off if either is refused.

export function NearbyRoomsSetting() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; phoneSettings: boolean } | null>(
    null,
  );
  const text = copy.nearby;

  useEffect(() => {
    if (!nearbySupported) return;
    let current = true;
    void nearbyWatcher.isEnabled().then((on) => {
      if (current) setEnabled(on);
    });
    return () => {
      current = false;
    };
  }, []);

  // The web has no background tasks, and the setting would do nothing there.
  if (!nearbySupported || enabled === null) return null;

  async function turnOn() {
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await enableNearby();
      if (outcome === "on") setEnabled(true);
      else
        setProblem({
          text: enableProblemMessage(outcome),
          phoneSettings: needsPhoneSettings(outcome),
        });
    } catch (error) {
      console.warn("Rooms near you: couldn't turn on:", error);
      setProblem({ text: copy.errors.unknown, phoneSettings: false });
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setProblem(null);
    try {
      await nearbyWatcher.disable();
      setEnabled(false);
    } catch (error) {
      console.warn("Rooms near you: couldn't turn off:", error);
      setProblem({ text: copy.errors.unknown, phoneSettings: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="gap-3">
      <Card className="gap-3">
        <View className="min-h-12 flex-row items-center gap-3">
          <Text className="flex-1">{text.title}</Text>
          <Switch
            value={enabled}
            onValueChange={(on) => void (on ? turnOn() : turnOff())}
            disabled={busy}
            accessibilityLabel={text.title}
          />
        </View>
        <Text variant="caption" tone="secondary">
          {text.explain}
        </Text>
      </Card>
      {problem ? (
        <View className="gap-2">
          <Text tone="error" accessibilityRole="alert" accessibilityLiveRegion="polite">
            {problem.text}
          </Text>
          {problem.phoneSettings ? (
            <Button
              title={text.openSettings}
              variant="ghost"
              onPress={() => void Linking.openSettings()}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
