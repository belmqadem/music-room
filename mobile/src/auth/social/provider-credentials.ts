import { NativeModules, Platform, TurboModuleRegistry } from "react-native";
import {
  type NativeSdks,
  pickFacebookCredential,
  SocialSignInError,
  socialConfigFrom,
} from "./social-config";

export { SocialSignInError };

// Getting a credential from Google or Facebook on the phone (ADR-033). The native SDKs are loaded
// only when used: they do not exist in Expo Go or on the web build, and loading them eagerly would
// crash the app there. Our session is the backend's (ADR-028), so each SDK is signed out again
// right after it hands over its token.

/**
 * The same lookups the SDKs make when they load (Google: a TurboModule, Facebook: a legacy native
 * module), so a button is shown only when its SDK can start. Both are missing in Expo Go. Not
 * attempted on the web, which has neither registry.
 */
function nativeSdksInThisApp(): NativeSdks {
  if (Platform.OS === "web") return { google: false, facebook: false };
  return {
    google: TurboModuleRegistry.get("RNGoogleSignin") != null,
    facebook: NativeModules.FBLoginManager != null,
  };
}

export const socialConfig = socialConfigFrom(
  {
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    EXPO_PUBLIC_FACEBOOK_APP_ID: process.env.EXPO_PUBLIC_FACEBOOK_APP_ID,
  },
  Platform.OS,
  nativeSdksInThisApp(),
);

export type ProviderOutcome =
  { kind: "credential"; credential: string } | { kind: "cancelled" };

export async function getGoogleCredential(): Promise<ProviderOutcome> {
  const config = socialConfig.google;
  if (!config) throw new SocialSignInError("unavailable");
  let sdk: typeof import("@react-native-google-signin/google-signin");
  try {
    sdk = await import("@react-native-google-signin/google-signin");
  } catch {
    throw new SocialSignInError("unavailable");
  }
  const { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } = sdk;
  try {
    GoogleSignin.configure({
      webClientId: config.webClientId,
      iosClientId: config.iosClientId,
      offlineAccess: false,
    });
    if (Platform.OS === "android")
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return { kind: "cancelled" };
    const idToken = response.data.idToken;
    await GoogleSignin.signOut().catch(() => undefined); // best effort: the token is already ours
    if (!idToken) throw new SocialSignInError("failed");
    return { kind: "credential", credential: idToken };
  } catch (error) {
    if (error instanceof SocialSignInError) throw error;
    if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED)
      return { kind: "cancelled" };
    console.warn("Google sign-in failed:", isErrorWithCode(error) ? error.code : error);
    throw new SocialSignInError("failed");
  }
}

export async function getFacebookCredential(): Promise<ProviderOutcome> {
  if (!socialConfig.facebook) throw new SocialSignInError("unavailable");
  let sdk: typeof import("react-native-fbsdk-next");
  try {
    sdk = await import("react-native-fbsdk-next");
  } catch {
    throw new SocialSignInError("unavailable");
  }
  const { AccessToken, AuthenticationToken, LoginManager, Settings } = sdk;
  try {
    // The adapter already loads the SDK at app launch (app delegate); initializing here is a safety
    // net. Event logging and advertiser-id collection are off in app.config.ts.
    Settings.initializeSDK();
    // Only the public profile: the backend ignores the Facebook email anyway (ADR-011).
    const result = await LoginManager.logInWithPermissions(["public_profile"]);
    if (result.isCancelled) return { kind: "cancelled" };
    const access = await AccessToken.getCurrentAccessToken();
    const limited =
      Platform.OS === "ios"
        ? await AuthenticationToken.getAuthenticationTokenIOS()
        : null;
    LoginManager.logOut();
    const credential = pickFacebookCredential({
      accessToken: access?.accessToken,
      limitedLoginToken: limited?.authenticationToken,
    });
    if (!credential) throw new SocialSignInError("failed");
    return { kind: "credential", credential };
  } catch (error) {
    if (error instanceof SocialSignInError) throw error;
    console.warn("Facebook sign-in failed:", error);
    throw new SocialSignInError("failed");
  }
}
