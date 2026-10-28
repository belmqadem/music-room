import { auth } from "@/auth";
import type { RequestOptions } from "@/auth/auth-controller";

// The backend as the screens use it. Every call carries the X-Platform / X-Device / X-App-Version
// headers and the access token; an expired token is refreshed once, transparently. Failures are
// RequestError (api/api-error.ts). Public endpoints (login, register, ...) are on `auth` instead.
//
//   const events = await api.get<Page<MusicEvent>>("/events", { query: { limit: 20 } });
//   await api.put(`/events/${id}/tracks/${trackId}/vote`, { body: {} });
export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, "body" | "auth">) =>
    auth.request<T>("GET", path, options),
  post: <T = void>(path: string, options?: Omit<RequestOptions, "auth">) =>
    auth.request<T>("POST", path, options),
  put: <T = void>(path: string, options?: Omit<RequestOptions, "auth">) =>
    auth.request<T>("PUT", path, options),
  patch: <T = void>(path: string, options?: Omit<RequestOptions, "auth">) =>
    auth.request<T>("PATCH", path, options),
  delete: <T = void>(path: string, options?: Omit<RequestOptions, "auth">) =>
    auth.request<T>("DELETE", path, options),
};

export { isRequestError, RequestError } from "./api-error";
