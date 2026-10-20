// Which social sign-ins this build can offer (ADR-033). Values are public OAuth identifiers, read
// from mobile/.env at build time (EXPO_PUBLIC_*), never secrets. A provider without its ids, without
// its native SDK in this app (Expo Go, or a build made before the SDKs were added), or on the web
// build (the native SDKs do not run in a browser), is simply not offered.

export interface SocialEnv {
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?: string;
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?: string;
  EXPO_PUBLIC_FACEBOOK_APP_ID?: string;
}

export interface SocialConfig {
  google: { webClientId: string; iosClientId: string | undefined } | null;
  facebook: { appId: string } | null;
}

/** Whether this app contains each provider's native SDK. Without it the button could only fail. */
export interface NativeSdks {
  google: boolean;
  facebook: boolean;
}

const present = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim() !== "";

export function socialConfigFrom(
  env: SocialEnv,
  platform: string,
  nativeSdks: NativeSdks,
): SocialConfig {
  if (platform === "web") return { google: null, facebook: null };
  return {
    // The Web client id is what the ID token is issued for: the backend's GOOGLE_CLIENT_IDS must list it.
    google:
      nativeSdks.google && present(env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID)
        ? {
            webClientId: env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.trim(),
            iosClientId: present(env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID)
              ? env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID.trim()
              : undefined,
          }
        : null,
    facebook:
      nativeSdks.facebook && present(env.EXPO_PUBLIC_FACEBOOK_APP_ID)
        ? { appId: env.EXPO_PUBLIC_FACEBOOK_APP_ID.trim() }
        : null,
  };
}

/**
 * What to send the backend after a Facebook login. On iOS the Limited Login token (a signed OpenID
 * JWT, ADR-032) whenever the SDK gives one: the backend verifies it locally, whatever the user said
 * about tracking. Found on a real simulator: after a Limited Login the iOS SDK ALSO returns an access
 * token, but one that Facebook's debug_token reports as invalid, so it must not be preferred.
 * Android gives no Limited Login token, so there the access token is sent.
 */
export function pickFacebookCredential(tokens: {
  accessToken: string | null | undefined;
  limitedLoginToken: string | null | undefined;
}): string | null {
  if (present(tokens.limitedLoginToken ?? undefined)) return tokens.limitedLoginToken!;
  if (present(tokens.accessToken ?? undefined)) return tokens.accessToken!;
  return null;
}

/** The SDK is missing from this build, or it failed before giving a credential. */
export class SocialSignInError extends Error {
  constructor(readonly reason: "unavailable" | "failed") {
    super(
      reason === "unavailable"
        ? "Social sign-in is not available in this build."
        : "Social sign-in failed.",
    );
    this.name = "SocialSignInError";
  }
}
