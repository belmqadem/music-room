import type { OAuthProvider } from "@music-room/shared";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { auth } from "@/auth";
import { socialErrorMessage } from "@/auth/forms/error-messages";
import { clearHandoff } from "@/auth/forms/handoff";
import {
  getFacebookCredential,
  getGoogleCredential,
  socialConfig,
  type ProviderOutcome,
} from "@/auth/social/provider-credentials";
import { Button, Text } from "@/components";
import { FormMessage } from "./parts";

interface Provider {
  id: OAuthProvider;
  name: "Google" | "Facebook";
  getCredential: () => Promise<ProviderOutcome>;
}

const PROVIDERS: Provider[] = [
  ...(socialConfig.google
    ? [
        {
          id: "google" as const,
          name: "Google" as const,
          getCredential: getGoogleCredential,
        },
      ]
    : []),
  ...(socialConfig.facebook
    ? [
        {
          id: "facebook" as const,
          name: "Facebook" as const,
          getCredential: getFacebookCredential,
        },
      ]
    : []),
];

// "Continue with Google / Facebook" (ADR-033). The provider's SDK gives the app a credential, the
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
        or
      </Text>
      {PROVIDERS.map((provider) => (
        <Button
          key={provider.id}
          title={`Continue with ${provider.name}`}
          variant="secondary"
          fullWidth
          loading={busy === provider.id}
          disabled={busy !== null && busy !== provider.id}
          onPress={() => continueWith(provider)}
        />
      ))}
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </View>
  );
}
