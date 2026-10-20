import type {
  AuthSession,
  EmailRequest,
  LoginRequest,
  OAuthProvider,
  RegisterRequest,
  RegisterResult,
  ResetPasswordRequest,
  User,
  VerifyEmailRequest,
} from "@music-room/shared";
import { RequestError, isRequestError } from "@/api/api-error";
import type { HttpClient, HttpMethod, SendOptions } from "@/api/http-client";

// The session of the signed-in user and every call that needs it (ADR-003, ADR-006, ADR-010).
// Plain TypeScript with its dependencies passed in, so it is tested in Node (tests/).
//
// Where tokens live:
//   - access token (15 minutes): in memory only, never written anywhere;
//   - refresh token (7 days, single use): in RefreshTokenStorage (the phone's secure store, or
//     browser storage on web per ADR-012), and written BEFORE the new access token is used.
//
// Why the refresh is guarded: refresh tokens rotate and a token used twice revokes the whole
// session (strict reuse detection). So there is never more than one refresh in flight in this app
// (and, on web, across tabs), and the token is read from storage at the moment of use.

export type AuthStatus = "loading" | "signedOut" | "signedIn";

/** What the UI reads. A new object on every change, so React can compare it by identity. */
export interface AuthState {
  status: AuthStatus;
  user: User | null;
}

export interface RefreshTokenStorage {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

export interface AuthControllerDeps {
  http: HttpClient;
  storage: RefreshTokenStorage;
  /**
   * Runs a refresh so that no other tab does one at the same time (web: navigator.locks).
   * Default: just run it; one app instance already has a single refresh in flight.
   */
  runExclusiveRefresh?: <T>(task: () => Promise<T>) => Promise<T>;
}

export interface RequestOptions {
  body?: unknown;
  query?: SendOptions["query"];
  /** false for the public endpoints (login, register, ...): no token is sent and none is refreshed. */
  auth?: boolean;
}

export interface SignOutResult {
  /** False when the server could not be told (offline); the phone is signed out regardless. */
  serverRevoked: boolean;
}

export function createAuthController(deps: AuthControllerDeps) {
  const { http, storage } = deps;
  const runExclusive = deps.runExclusiveRefresh ?? ((task) => task());

  let state: AuthState = { status: "loading", user: null };
  let accessToken: string | null = null;
  // Only a fallback for when the storage refuses a write: the session then lasts until the app
  // is closed, instead of ending in the middle of use.
  let memoryRefreshToken: string | null = null;
  const listeners = new Set<() => void>();

  function setState(next: AuthState): void {
    state = next;
    listeners.forEach((listener) => listener());
  }

  async function readRefreshToken(): Promise<string | null> {
    try {
      return (await storage.get()) ?? memoryRefreshToken;
    } catch (error) {
      console.warn("Could not read the refresh token from storage:", error);
      return memoryRefreshToken;
    }
  }

  async function writeRefreshToken(token: string): Promise<void> {
    memoryRefreshToken = token;
    await storage.set(token);
  }

  /** Forget the session here first, then on disk. If the disk refuses, the error is raised, not hidden. */
  async function clearSession(): Promise<void> {
    accessToken = null;
    memoryRefreshToken = null;
    setState({ status: "signedOut", user: null });
    await storage.clear();
  }

  async function applySession(session: AuthSession): Promise<void> {
    // The new refresh token is saved first: the old one is already spent on the server.
    try {
      await writeRefreshToken(session.refreshToken);
    } catch (error) {
      console.warn(
        "Could not save the refresh token; the session lasts until the app closes:",
        error,
      );
    }
    accessToken = session.accessToken;
    setState({ status: "signedIn", user: session.user });
  }

  // ---- refresh ----

  type RefreshOutcome = "refreshed" | "lost";
  let refreshing: Promise<RefreshOutcome> | null = null;

  async function doRefresh(): Promise<RefreshOutcome> {
    const token = await readRefreshToken();
    if (token === null) {
      await clearSession();
      return "lost";
    }
    try {
      const session = await http.send<AuthSession>("POST", "/auth/refresh", {
        body: { refreshToken: token },
      });
      await applySession(session);
      return "refreshed";
    } catch (error) {
      // The server says this session is over (expired, revoked, or the token was used twice).
      if (isRequestError(error) && error.status === 401) {
        await clearSession();
        return "lost";
      }
      // Anything else (offline, server down): the tokens are kept so a later try can work.
      throw error;
    }
  }

  function refresh(): Promise<RefreshOutcome> {
    refreshing ??= runExclusive(doRefresh).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  // ---- calls ----

  /**
   * One call to the backend. With `auth` (the default) it sends the access token; if the server says
   * the token expired it refreshes once, then repeats the call once. A second 401 ends the session.
   */
  async function request<T = void>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const { auth = true, ...sendOptions } = options;
    if (!auth) return http.send<T>(method, path, sendOptions);

    const tokenSent = accessToken;
    try {
      return await http.send<T>(method, path, { ...sendOptions, accessToken: tokenSent });
    } catch (error) {
      if (!(
        isRequestError(error) &&
        error.status === 401 &&
        error.code === "TOKEN_EXPIRED"
      )) {
        throw error;
      }
    }

    // Another call may already have refreshed while this one was in flight: then just repeat it.
    if (accessToken === tokenSent) {
      if ((await refresh()) === "lost") {
        throw new RequestError(
          401,
          "UNAUTHENTICATED",
          "Your session has ended. Sign in again.",
        );
      }
    }
    try {
      return await http.send<T>(method, path, { ...sendOptions, accessToken });
    } catch (error) {
      if (isRequestError(error) && error.status === 401) await clearSession();
      throw error;
    }
  }

  // ---- session lifecycle ----

  let restoring: Promise<void> | null = null;

  /** At app start: sign in again from the stored refresh token, if there is one. Never throws. */
  function restore(): Promise<void> {
    restoring ??= (async () => {
      try {
        if ((await readRefreshToken()) === null) {
          setState({ status: "signedOut", user: null });
          return;
        }
        await refresh();
      } catch (error) {
        // Offline at start: stay signed out for now but KEEP the stored token for the next launch.
        console.warn("Could not restore the session:", error);
        setState({ status: "signedOut", user: null });
      }
    })().finally(() => {
      restoring = null;
    });
    return restoring;
  }

  async function signIn(credentials: LoginRequest): Promise<void> {
    const session = await request<AuthSession>("POST", "/auth/login", {
      auth: false,
      body: credentials,
    });
    await applySession(session);
  }

  /** `credential` is the Google ID token or the Facebook access token the provider gave the app. */
  async function signInWithProvider(
    provider: OAuthProvider,
    credential: string,
  ): Promise<void> {
    const session = await request<AuthSession>("POST", `/auth/oauth/${provider}`, {
      auth: false,
      body: { credential },
    });
    await applySession(session);
  }

  async function signOut(): Promise<SignOutResult> {
    const token = await readRefreshToken();
    let serverRevoked = token === null;
    if (token !== null) {
      try {
        await request("POST", "/auth/logout", { body: { refreshToken: token } });
        serverRevoked = true;
      } catch (error) {
        // Signing out here must not depend on the network. The caller is told it was not revoked.
        console.warn("Could not tell the server about the sign-out:", error);
      }
    }
    await clearSession();
    return { serverRevoked };
  }

  /** Reloads the signed-in user (for example after linking a provider). */
  async function refreshUser(): Promise<User> {
    const user = await request<User>("GET", "/users/me");
    if (state.status === "signedIn") setState({ status: "signedIn", user });
    return user;
  }

  // ---- public endpoints (no session) ----

  const register = (input: RegisterRequest) =>
    request<RegisterResult>("POST", "/auth/register", { auth: false, body: input });
  const verifyEmail = (input: VerifyEmailRequest) =>
    request("POST", "/auth/verify-email", { auth: false, body: input });
  const resendVerification = (input: EmailRequest) =>
    request("POST", "/auth/resend-verification", { auth: false, body: input });
  const forgotPassword = (input: EmailRequest) =>
    request("POST", "/auth/forgot-password", { auth: false, body: input });
  const resetPassword = (input: ResetPasswordRequest) =>
    request("POST", "/auth/reset-password", { auth: false, body: input });

  return {
    getState: (): AuthState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** For the live connection's handshake (`auth: { token }`). Null when signed out. */
    getAccessToken: (): string | null => accessToken,
    /**
     * For the live connection, whose handshake was refused with TOKEN_EXPIRED: a new access token,
     * from the same single refresh REST calls use (so a socket and a call expiring together refresh
     * once). False when the session is over (signed out). Offline or server errors are raised.
     */
    refreshAccessToken: async (): Promise<boolean> => (await refresh()) === "refreshed",
    request,
    restore,
    signIn,
    signInWithProvider,
    signOut,
    refreshUser,
    register,
    verifyEmail,
    resendVerification,
    forgotPassword,
    resetPassword,
  };
}

export type AuthController = ReturnType<typeof createAuthController>;
