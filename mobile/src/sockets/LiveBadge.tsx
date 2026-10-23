import { useSyncExternalStore } from "react";
import { Badge } from "@/components";
import { live } from "./live";
import type { LiveStatus } from "./live-connection";

/** The live connection's state, re-rendering when it changes. */
export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(live.onStatus, live.getStatus, live.getStatus);
}

/** Chartreuse is for live state only (DESIGN.md rule 4): shown only while updates really arrive. */
export function LiveBadge() {
  const status = useLiveStatus();
  if (status === "live") return <Badge label="Live" tone="live" />;
  if (status === "offline") return <Badge label="Not live" tone="error" />;
  return <Badge label="Connecting" />;
}
