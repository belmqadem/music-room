import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";

// The backend must log platform, device and app version for every
// mobile-triggered action; every request carries them as headers.
export function buildClientHeaders(): Record<string, string> {
  return {
    "X-Platform": Platform.OS,
    "X-Device": Device.modelName ?? "unknown",
    "X-App-Version": Constants.expoConfig?.version ?? "unknown",
  };
}
