import AsyncStorage from "@react-native-async-storage/async-storage";

// The backend address must be changeable at RUNTIME (the subject requires it
// for tests), so it is stored on-device and read on every request instead of
// being baked into the bundle. EXPO_PUBLIC_API_URL is only the first-launch
// default. This is a client preference, not authoritative state.
const STORAGE_KEY = "settings.backendUrl";
const DEFAULT_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

/** Returns a normalized http(s) URL without trailing slash, or throws. */
export function normalizeBackendUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`Invalid backend URL: "${input}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Backend URL must start with http:// or https:// (got "${input}")`);
  }
  return url.toString().replace(/\/+$/, "");
}

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
