import { auth } from "@/auth";
import { socialErrorMessage } from "@/auth/forms/error-messages";
import { clearHandoff } from "@/auth/forms/handoff";
import { type Provider, ProviderLogo, PROVIDERS } from "@/auth/social/providers";
import { Button, Text } from "@/components";
import type { OAuthProvider } from "@music-room/shared";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { FormMessage } from "./parts";
import { copy } from "@/copy";

// The Google and Facebook buttons: logo + provider name (ADR-033). The provider's SDK gives the app a credential, the
// backend checks it with the provider (ADR-011, ADR-032) and answers with our own session. Secondary
// buttons: the screen's one Ember button stays its email action. Nothing is shown when the build
// has no provider configured.
export function SocialSignIn() {
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (PROVIDERS.length === 0) return null;

  async function continueWith(provider: Provider) {
    setBusy(provider.id);
    setError(null);
    try {
      const outcome = await provider.getCredential();
      if (outcome.kind === "cancelled") return;
      await auth.signInWithProvider(provider.id, outcome.credential);
      clearHandoff();
      router.replace("/events");
    } catch (failure) {
      setError(socialErrorMessage(failure, provider.name));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View className="gap-3">
      <Text tone="secondary" className="text-center">
        {copy.common.or}
      </Text>
      <View className="flex flex-row gap-3 justify-center items-center">
        {/* Each button gets an equal share of the row: flex-1 here, not in Button, so other
            buttons keep their own size. */}
        {PROVIDERS.map((provider) => (
          <View key={provider.id} className="flex-1">
            <Button
              title={provider.name}
              icon={<ProviderLogo provider={provider.id} />}
              accessibilityLabel={copy.auth.social.continueWith(provider.name)}
              variant="secondary"
              fullWidth
              loading={busy === provider.id}
              disabled={busy !== null && busy !== provider.id}
              onPress={() => continueWith(provider)}
            />
          </View>
        ))}
      </View>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </View>
  );
}
