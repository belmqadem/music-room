import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalizeBackendUrl } from "./server-address";

// The backend address must be changeable at RUNTIME (the subject requires it
// for tests), so it is stored on-device and read on every request instead of
// being baked into the bundle. EXPO_PUBLIC_API_URL is only the first-launch
// default. This is a client preference, not authoritative state.
const STORAGE_KEY = "settings.backendUrl";
const DEFAULT_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

/** The address this build starts with (EXPO_PUBLIC_API_URL), for "Reset to default". */
export const defaultBackendUrl = (): string => normalizeBackendUrl(DEFAULT_URL);

export async function getBackendUrl(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return stored ?? normalizeBackendUrl(DEFAULT_URL);
  } catch (error) {
    // Storage can fail (e.g. corrupted/denied); the app should still be usable.
    console.warn("Could not read backend URL from storage, using default:", error);
    return normalizeBackendUrl(DEFAULT_URL);
  }
}

export async function setBackendUrl(input: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, normalizeBackendUrl(input));
}

export async function resetBackendUrl(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
