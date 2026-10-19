/// <reference types="node" />
// Node types for this file only: TypeScript 6 does not load @types automatically, and the app code
// must not see Node globals.
import type { ExpoConfig } from "expo/config";
import { describe, expect, it } from "vitest";
import { RequestError } from "@/api/api-error";
import { MESSAGES, socialErrorMessage } from "@/auth/forms/error-messages";
import {
  pickFacebookCredential,
  socialConfigFrom,
  SocialSignInError,
} from "@/auth/social/social-config";
import {
  iosUrlSchemeFromClientId,
  signDebugWithDeveloperKey,
  withSocialSignIn,
} from "../app.config";

const WEB = "111-web.apps.googleusercontent.com";
const IOS = "222-ios.apps.googleusercontent.com";

describe("which providers a build offers", () => {
  it("offers nothing when no ids are set", () => {
    expect(socialConfigFrom({}, "ios")).toEqual({ google: null, facebook: null });
  });

  it("offers Google once the Web client id is set (the ID token is issued for it); the iOS id is optional", () => {
    expect(
      socialConfigFrom({ EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: ` ${WEB} ` }, "android")
        .google,
    ).toEqual({
      webClientId: WEB,
      iosClientId: undefined,
    });
    expect(
      socialConfigFrom(
        { EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: WEB, EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: IOS },
        "ios",
      ).google,
    ).toEqual({ webClientId: WEB, iosClientId: IOS });
  });

  it("does not offer Google with only the iOS id, or blank values", () => {
    expect(
      socialConfigFrom({ EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: IOS }, "ios").google,
    ).toBeNull();
    expect(
      socialConfigFrom({ EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "  " }, "ios").google,
    ).toBeNull();
  });

  it("offers Facebook once the app id is set", () => {
    expect(
      socialConfigFrom({ EXPO_PUBLIC_FACEBOOK_APP_ID: "123" }, "ios").facebook,
    ).toEqual({ appId: "123" });
  });

  it("offers nothing on the web build: the native SDKs do not run in a browser", () => {
    const all = {
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: WEB,
      EXPO_PUBLIC_FACEBOOK_APP_ID: "123",
    };

    expect(socialConfigFrom(all, "web")).toEqual({ google: null, facebook: null });
  });
});

describe("Google's iOS URL scheme", () => {
  it("is the iOS client id reversed", () => {
    expect(iosUrlSchemeFromClientId(IOS)).toBe("com.googleusercontent.apps.222-ios");
    expect(iosUrlSchemeFromClientId(` ${IOS} `)).toBe(
      "com.googleusercontent.apps.222-ios",
    );
  });

  it("refuses something that is not a Google iOS client id", () => {
    expect(() => iosUrlSchemeFromClientId("123")).toThrow(/Not a Google iOS client id/);
    expect(() => iosUrlSchemeFromClientId(".apps.googleusercontent.com")).toThrow();
  });
});

describe("the Facebook credential sent to the backend", () => {
  it("is the Limited Login token whenever iOS gives one, even with an access token next to it", () => {
    // Seen on the simulator: after a Limited Login the SDK also returns an access token that
    // Facebook's debug_token reports as invalid. The signed JWT is the one the backend can verify.
    expect(
      pickFacebookCredential({ accessToken: "EAA-token", limitedLoginToken: "a.b.c" }),
    ).toBe("a.b.c");
    expect(
      pickFacebookCredential({ accessToken: null, limitedLoginToken: "a.b.c" }),
    ).toBe("a.b.c");
  });

  it("is the access token when there is no Limited Login token (Android)", () => {
    expect(
      pickFacebookCredential({ accessToken: "EAA-token", limitedLoginToken: null }),
    ).toBe("EAA-token");
    expect(
      pickFacebookCredential({ accessToken: "EAA-token", limitedLoginToken: "" }),
    ).toBe("EAA-token");
  });

  it("is nothing when the SDK gave neither", () => {
    expect(
      pickFacebookCredential({ accessToken: undefined, limitedLoginToken: null }),
    ).toBeNull();
  });
});

describe("social sign-in messages", () => {
  const fail = (status: number, code: string) =>
    new RequestError(status, code as RequestError["code"], "raw");

  it("explains a build without the SDK, and an SDK failure", () => {
    expect(socialErrorMessage(new SocialSignInError("unavailable"), "Google")).toMatch(
      /isn't set up/,
    );
    expect(socialErrorMessage(new SocialSignInError("failed"), "Facebook")).toBe(
      "Facebook sign-in didn't work. Try again.",
    );
  });

  it("names the provider for the backend's answers", () => {
    expect(socialErrorMessage(fail(401, "INVALID_PROVIDER_CREDENTIAL"), "Google")).toBe(
      "Google didn't confirm your account. Try again.",
    );
    expect(socialErrorMessage(fail(502, "PROVIDER_UNAVAILABLE"), "Facebook")).toMatch(
      /^Facebook sign-in isn't available/,
    );
  });

  it("explains that an existing account must sign in and link (no linking by email, ADR-007)", () => {
    expect(socialErrorMessage(fail(409, "EMAIL_TAKEN"), "Google")).toMatch(
      /Sign in with your password, then link Google/,
    );
  });

  it("falls back to the usual messages and never shows raw server text", () => {
    expect(socialErrorMessage(fail(0, "NETWORK_ERROR"), "Google")).toBe(MESSAGES.network);
    expect(socialErrorMessage(fail(500, "INTERNAL_ERROR"), "Google")).toBe(
      MESSAGES.server,
    );
    expect(socialErrorMessage(new Error("boom"), "Google")).toBe(MESSAGES.server);
  });
});

describe("the build configuration (app.config.ts)", () => {
  const base: ExpoConfig = {
    name: "music room",
    slug: "music-room",
    plugins: ["expo-router"],
  };
  const pluginNamed = (config: ExpoConfig, name: string) =>
    (config.plugins ?? []).find(
      (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === name,
    );

  it("adds no SDK when the ids are missing, so a build without them still works", () => {
    expect(withSocialSignIn(base, {}).plugins).toEqual(["expo-router"]);
  });

  it("adds Google with the reversed iOS client id once both Google ids are set", () => {
    const config = withSocialSignIn(base, {
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: WEB,
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: IOS,
    });

    expect(pluginNamed(config, "@react-native-google-signin/google-signin")).toEqual([
      "@react-native-google-signin/google-signin",
      { iosUrlScheme: "com.googleusercontent.apps.222-ios" },
    ]);
  });

  it("adds Facebook only with both the app id and the client token, never asking for tracking", () => {
    expect(
      pluginNamed(
        withSocialSignIn(base, { EXPO_PUBLIC_FACEBOOK_APP_ID: "123" }),
        "react-native-fbsdk-next",
      ),
    ).toBeUndefined();

    const config = withSocialSignIn(base, {
      EXPO_PUBLIC_FACEBOOK_APP_ID: "123",
      FACEBOOK_CLIENT_TOKEN: "client-token",
    });
    const [, options] = pluginNamed(config, "react-native-fbsdk-next") as [
      string,
      Record<string, unknown>,
    ];

    expect(options).toMatchObject({
      appID: "123",
      clientToken: "client-token",
      scheme: "fb123",
      iosUserTrackingPermission: false,
      advertiserIDCollectionEnabled: false,
      autoLogAppEventsEnabled: false,
    });
  });

  it("keeps the plugins of app.json and does not change the config it was given", () => {
    const config = withSocialSignIn(base, {
      EXPO_PUBLIC_FACEBOOK_APP_ID: "123",
      FACEBOOK_CLIENT_TOKEN: "t",
    });

    expect(config.plugins?.[0]).toBe("expo-router");
    expect(base.plugins).toEqual(["expo-router"]);
  });
});

describe("Android debug signing (app.config.ts)", () => {
  // The signing block exactly as `expo prebuild` generates it (SDK 57).
  const generated = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;

  it("uses the developer's own ~/.android/debug.keystore, falling back to the template key", () => {
    const signed = signDebugWithDeveloperKey(generated);

    expect(signed).toContain(
      'new File(System.getProperty("user.home"), ".android/debug.keystore")',
    );
    expect(signed).toContain(
      "storeFile developerDebugKeystore.exists() ? developerDebugKeystore : file('debug.keystore')",
    );
    expect(signed).not.toContain("storeFile file('debug.keystore')");
  });

  it("keeps the rest of the signing block (alias and passwords of every debug key)", () => {
    const signed = signDebugWithDeveloperKey(generated);

    for (const line of [
      "storePassword 'android'",
      "keyAlias 'androiddebugkey'",
      "keyPassword 'android'",
    ])
      expect(signed).toContain(line);
  });

  it("changes nothing when applied twice (prebuild can run again on the same folder)", () => {
    const once = signDebugWithDeveloperKey(generated);

    expect(signDebugWithDeveloperKey(once)).toBe(once);
  });

  it("refuses a build.gradle without the expected line, rather than keep the shared key silently", () => {
    expect(() => signDebugWithDeveloperKey("android { }")).toThrow(/debug\.keystore/);
  });
});
