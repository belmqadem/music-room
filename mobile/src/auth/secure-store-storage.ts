import * as SecureStore from "expo-secure-store";
import type { RefreshTokenStorage } from "./auth-controller";

// The refresh token on a phone: iOS Keychain / Android Keystore (ADR-006). Keys may only contain
// letters, digits, ".", "-" and "_". AFTER_FIRST_UNLOCK so a background refresh still works while
// the phone is locked after the first unlock. SecureStore does not exist on web (see web-storage.ts).
const KEY = "music-room.refresh-token";
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export function createSecureStoreStorage(): RefreshTokenStorage {
  return {
    get: () => SecureStore.getItemAsync(KEY, OPTIONS),
    set: (token) => SecureStore.setItemAsync(KEY, token, OPTIONS),
    clear: () => SecureStore.deleteItemAsync(KEY, OPTIONS),
  };
}
