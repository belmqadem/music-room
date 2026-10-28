import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { isRequestError } from "@/api/api-error";
import type { HttpClient } from "@/api/http-client";
import { getBackendUrl } from "@/settings/backend-url";
import { createConnectivity } from "./connectivity";
import { createOfflineStore } from "./offline-store";

// Offline mode's shared pieces (ADR-049): the store of offline copies and whether the server can
// be reached. Features import these; the modules above them hold the logic, tested on its own.

export const offlineStore = createOfflineStore(AsyncStorage);

export const connectivity = createConnectivity({
  async ping() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(`${await getBackendUrl()}/health`, {
        signal: controller.signal,
      });
      return response.ok;
    } finally {
      clearTimeout(timer);
    }
  },
});

/** True when the call failed because the server could not be reached (not a refusal). */
export const isUnreachable = (error: unknown): boolean =>
  isRequestError(error) && error.code === "NETWORK_ERROR";

/** Every call reports whether the server answered: that is what "offline" means here. */
export function reportingConnectivity(http: HttpClient): HttpClient {
  return {
    async send(method, path, options) {
      try {
        const result = await http.send(method, path, options);
        connectivity.reportReachable();
        return result as never;
      } catch (error) {
        if (isUnreachable(error)) connectivity.reportUnreachable();
        else connectivity.reportReachable();
        throw error;
      }
    },
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(connectivity.subscribe, connectivity.isOnline);
}
