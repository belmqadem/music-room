import type { User } from "@music-room/shared";
import { Platform } from "react-native";
import { buildClientHeaders } from "@/api/client-headers";
import { createHttpClient } from "@/api/http-client";
import { stopWatchingRooms } from "@/features/nearby/stop-watching";
import { offlineStore, reportingConnectivity } from "@/offline";
import { getBackendUrl } from "@/settings/backend-url";
import { createAuthController } from "./auth-controller";
import { createSecureStoreStorage } from "./secure-store-storage";
import { createWebRefreshLock, createWebStorage } from "./web-storage";

// The one auth controller of the app: sign-in state, token storage and the authenticated API calls.
// Import it from "@/auth"; read the state in components with `useAuth()`.
const isWeb = Platform.OS === "web";

export const auth = createAuthController({
  // Every call also tells offline mode whether the server answered (ADR-049).
  http: reportingConnectivity(
    createHttpClient({
      fetch: (input, init) => fetch(input, init),
      getBaseUrl: getBackendUrl,
      getClientHeaders: buildClientHeaders,
    }),
  ),
  storage: isWeb ? createWebStorage() : createSecureStoreStorage(),
  ...(isWeb && { runExclusiveRefresh: createWebRefreshLock() }),
  // The last signed-in user, to open the app offline (ADR-049). Signing out removes it, and with
  // it every offline copy and pending change (whoever signs in next starts clean), and stops
  // watching for rooms near you, which that person turned on for themselves (ADR-052).
  savedUser: {
    read: async () => (await offlineStore.read<User>("user"))?.data ?? null,
    write: (user) => offlineStore.write("user", user),
    // The copies first: with "on" gone, a region the phone still reports is ignored and stopped.
    clear: async () => {
      await offlineStore.clear();
      await stopWatchingRooms();
    },
  },
});
