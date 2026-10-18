import { useSyncExternalStore } from "react";
import type { AuthState } from "./auth-controller";
import { auth } from "./auth-instance";

/** The signed-in state, re-rendering the component when it changes. Actions are on `auth`. */
export function useAuth(): AuthState {
  return useSyncExternalStore(auth.subscribe, auth.getState, auth.getState);
}
