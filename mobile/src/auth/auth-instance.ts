import { Platform } from "react-native";
import { buildClientHeaders } from "@/api/client-headers";
import { createHttpClient } from "@/api/http-client";
import { getBackendUrl } from "@/settings/backend-url";
import { createAuthController } from "./auth-controller";
import { createSecureStoreStorage } from "./secure-store-storage";
import { createWebRefreshLock, createWebStorage } from "./web-storage";

// The one auth controller of the app: sign-in state, token storage and the authenticated API calls.
// Import it from "@/auth"; read the state in components with `useAuth()`.
const isWeb = Platform.OS === "web";

export const auth = createAuthController({
  http: createHttpClient({
    fetch: (input, init) => fetch(input, init),
    getBaseUrl: getBackendUrl,
    getClientHeaders: buildClientHeaders,
  }),
  storage: isWeb ? createWebStorage() : createSecureStoreStorage(),
  ...(isWeb && { runExclusiveRefresh: createWebRefreshLock() }),
});
