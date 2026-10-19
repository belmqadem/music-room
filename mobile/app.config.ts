import type { ConfigContext, ExpoConfig } from "expo/config";

// app.json holds the static config; this adds what depends on mobile/.env (ADR-033): the Google and
// Facebook sign-in SDKs, each only when its ids are set, so a build without them still works.
// FACEBOOK_CLIENT_TOKEN has no EXPO_PUBLIC_ prefix: it is only needed here, at build time.
// Self-contained on purpose: Expo compiles this file alone, so it cannot import from src/.
/**
 * The iOS URL scheme Google's SDK needs is the iOS client id reversed:
 * "123-abc.apps.googleusercontent.com" becomes "com.googleusercontent.apps.123-abc".
 */
export function iosUrlSchemeFromClientId(iosClientId: string): string {
  const suffix = ".apps.googleusercontent.com";
  const id = iosClientId.trim();
  if (!id.endsWith(suffix) || id.length === suffix.length) {
    throw new Error(`Not a Google iOS client id: expected "<id>${suffix}"`);
  }
  return `com.googleusercontent.apps.${id.slice(0, -suffix.length)}`;
}

export function withSocialSignIn(
  config: ExpoConfig,
  env: Record<string, string | undefined>,
): ExpoConfig {
  const plugins: NonNullable<ExpoConfig["plugins"]> = [...(config.plugins ?? [])];

  const googleIos = env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
  if (env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() && googleIos) {
    plugins.push([
      "@react-native-google-signin/google-signin",
      { iosUrlScheme: iosUrlSchemeFromClientId(googleIos) },
    ]);
  }

  const facebookAppId = env.EXPO_PUBLIC_FACEBOOK_APP_ID?.trim();
  const facebookClientToken = env.FACEBOOK_CLIENT_TOKEN?.trim();
  if (facebookAppId && facebookClientToken) {
    plugins.push([
      "react-native-fbsdk-next",
      {
        appID: facebookAppId,
        clientToken: facebookClientToken,
        displayName: "Music Room",
        scheme: `fb${facebookAppId}`,
        // We never ask for tracking: without it iOS gives a Limited Login token (ADR-032).
        iosUserTrackingPermission: false,
        advertiserIDCollectionEnabled: false,
        autoLogAppEventsEnabled: false,
        isAutoInitEnabled: false,
      },
    ]);
  }

  return { ...config, plugins };
}

export default ({ config }: ConfigContext): ExpoConfig =>
  withSocialSignIn(config as ExpoConfig, process.env);
