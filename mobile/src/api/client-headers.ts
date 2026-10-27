import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";

// The backend must log platform, device and app version for every
// mobile-triggered action; every request carries them as headers.
export function buildClientHeaders(): Record<string, string> {
  return {
    "X-Platform": Platform.OS,
    "X-Device":
      Platform.OS === "web"
        ? browserDeviceName(globalThis.navigator?.userAgent ?? "")
        : (Device.modelName ?? "unknown"),
    "X-App-Version": Constants.expoConfig?.version ?? "unknown",
  };
}

// Checked in order: Edge and Opera also say "Chrome", and Chrome also says "Safari".
const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];
// iPhones and iPads also say "like Mac OS X", and Android also says "Linux".
const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/CrOS/, "ChromeOS"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
];

/**
 * The web has no device model, so the browser stands in for it in the logs: "Chrome on macOS".
 * Logging only (ADR-050): a client can send any user agent, so it never decides anything.
 */
export function browserDeviceName(userAgent: string): string {
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "Web browser";
}
