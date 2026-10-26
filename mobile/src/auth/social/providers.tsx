import type { OAuthProvider } from "@music-room/shared";
import { Image } from "react-native";
import {
  getFacebookCredential,
  getGoogleCredential,
  type ProviderOutcome,
  socialConfig,
} from "./provider-credentials";

// The social providers this build can use, and their logos: shared by sign-in (SocialSignIn) and
// Settings, where they are linked and unlinked (ADR-025, ADR-044).

export type ProviderName = "Google" | "Facebook";

export interface Provider {
  id: OAuthProvider;
  name: ProviderName;
  getCredential: () => Promise<ProviderOutcome>;
}

export const PROVIDER_NAMES: Record<OAuthProvider, ProviderName> = {
  google: "Google",
  facebook: "Facebook",
};

/** Only those whose SDK and keys are in this build (none in Expo Go or on the web). */
export const PROVIDERS: Provider[] = [
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

export const providerIn = (id: OAuthProvider): Provider | undefined =>
  PROVIDERS.find((provider) => provider.id === id);

// The providers' own logos, in their brand colors. They are artwork (each brand requires its logo
// unaltered), not UI colors, so they stay out of the design tokens. PNGs at 1x/2x/3x rendered from
// the SVGs next to them, shown with React Native's own Image (no extra native view needed).
const LOGOS: Record<OAuthProvider, number> = {
  google: require("../../../assets/icons/google.png"),
  facebook: require("../../../assets/icons/facebook.png"),
};

/** 16 px, the size of a button label (h3). Decorative: the text next to it names the provider. */
export function ProviderLogo({ provider }: { provider: OAuthProvider }) {
  return (
    <Image
      source={LOGOS[provider]}
      className="size-4"
      resizeMode="contain"
      accessible={false}
    />
  );
}
