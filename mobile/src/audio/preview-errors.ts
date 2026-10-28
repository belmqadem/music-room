import { isRequestError } from "@/api/api-error";
import type { PreviewFailure } from "./preview-player";

/** No sample (or no such track), no connection, or anything else. */
export function classifyPreviewError(error: unknown): PreviewFailure {
  if (!isRequestError(error)) return "unknown";
  if (error.code === "PREVIEW_UNAVAILABLE" || error.code === "TRACK_NOT_FOUND")
    return "unavailable";
  if (error.code === "NETWORK_ERROR") return "offline";
  return "unknown";
}
