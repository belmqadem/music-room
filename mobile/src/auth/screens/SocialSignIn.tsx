import type { OAuthProvider } from "@music-room/shared";
import { Image } from "expo-image";
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

// The providers' own logos, in their brand colors. They are artwork files (like a PNG), not UI
// colors, so they stay out of the design tokens; each brand requires its logo unaltered.
const LOGOS: Record<OAuthProvider, number> = {
  google: require("../../../assets/icons/google.svg"),
  facebook: require("../../../assets/icons/facebook.svg"),
};

const FILL = { width: "100%", height: "100%" } as const;

/** 16 px, the size of the button label (h3). */
function ProviderLogo({ provider }: { provider: OAuthProvider }) {
  return (
    <View className="size-4">
      <Image
        source={LOGOS[provider]}
        contentFit="contain"
        // expo-image is not a React Native core view, so className is not applied to it.
        style={FILL}
        accessible={false}
      />
    </View>
  );
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
        or
      </Text>
      {PROVIDERS.map((provider) => (
        <Button
          key={provider.id}
          title={provider.name}
          icon={<ProviderLogo provider={provider.id} />}
          accessibilityLabel={`Continue with ${provider.name}`}
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
