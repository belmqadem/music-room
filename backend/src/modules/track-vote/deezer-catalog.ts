import type { Track } from "@music-room/shared";
import { z } from "zod";
import { CatalogUnavailableError, type CatalogProvider } from "./catalog.js";

const DEFAULT_BASE_URL = "https://api.deezer.com";
const TIMEOUT_MS = 5000;
const MAX_SEARCH_RESULTS = 25;
// Limits of the event_tracks columns (migration create-event-tracks-and-votes).
const MAX_TEXT_LENGTH = 500;
const MAX_COVER_URL_LENGTH = 2048;
const MAX_DURATION_SECONDS = 86_400;

// Deezer track ids are plain numbers. Only digits ever reach the URL, so a
// "track id" from a client can never rewrite the path or add a query.
const TRACK_ID = /^\d{1,15}$/;

// Deezer answers HTTP 200 even for failures and puts the error in the body.
const DEEZER_NO_DATA = 800;
const DEEZER_INVALID_QUERY = 600;

export interface DeezerCatalogOptions {
  /** Tests replace the network. */
  fetch?: typeof fetch;
  baseUrl?: string;
}

const rawTrackSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  duration: z.number(),
  artist: z.object({ name: z.string() }),
  album: z.object({ cover_medium: z.string().optional() }).optional(),
});
const errorBodySchema = z.object({ error: z.object({ code: z.number().optional() }) });
const searchBodySchema = z.object({ data: z.array(z.unknown()) });

// Control characters (including NUL, which Postgres refuses in text) and line breaks
// have no place in a title: they could break a log line or a screen layout.
const CONTROL_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

function cleanText(text: string): string {
  const singleLine = text.replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim();
  // Cut by whole characters, never in the middle of an emoji (two UTF-16 units).
  return Array.from(singleLine).slice(0, MAX_TEXT_LENGTH).join("").trim();
}

/**
 * Only https images served by Deezer's own image hosts (cdn-images.dzcdn.net and
 * its siblings) are kept. Anything else becomes "no cover", so a compromised or
 * spoofed catalog cannot make the app load an arbitrary URL.
 */
export function cleanCoverUrl(value: string | undefined): string | null {
  if (!value || value.length > MAX_COVER_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // `hostname` is what the browser will really contact (the part before an "@" is credentials).
  const isDeezerHost =
    url.hostname === "dzcdn.net" || url.hostname.endsWith(".dzcdn.net");
  if (url.protocol !== "https:" || !isDeezerHost || url.username || url.password)
    return null;
  return url.toString();
}

/** A usable Track from one raw Deezer object, or null if it is unusable. */
function toTrack(raw: unknown): Track | null {
  const parsed = rawTrackSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { id, title, duration, artist, album } = parsed.data;
  const providerTrackId = String(id);
  const cleanTitle = cleanText(title);
  const cleanArtist = cleanText(artist.name);
  if (!TRACK_ID.test(providerTrackId) || cleanTitle === "" || cleanArtist === "")
    return null;
  if (!Number.isFinite(duration) || duration < 0) return null;
  return {
    providerTrackId,
    title: cleanTitle,
    artist: cleanArtist,
    durationSeconds: Math.min(Math.round(duration), MAX_DURATION_SECONDS),
    coverUrl: cleanCoverUrl(album?.cover_medium),
  };
}

/** The Deezer public API (no key needed). The first answer is checked, never trusted. */
export function createDeezerCatalog(options: DeezerCatalogOptions = {}): CatalogProvider {
  const doFetch = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;

  // Returns the parsed JSON, or throws CatalogUnavailableError. Never puts the URL in an error.
  async function getJson(
    path: string,
    params: Record<string, string> = {},
  ): Promise<unknown> {
    const query = new URLSearchParams(params).toString();
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}${query ? `?${query}` : ""}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new CatalogUnavailableError("could not reach Deezer");
    }
    if (!response.ok)
      throw new CatalogUnavailableError(`Deezer answered ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new CatalogUnavailableError("Deezer sent an unreadable answer");
    }
  }

  return {
    async search(query, limit) {
      const body = await getJson("/search", {
        q: query,
        limit: String(Math.min(Math.max(Math.trunc(limit), 1), MAX_SEARCH_RESULTS)),
      });
      if (errorBodySchema.safeParse(body).success) {
        throw new CatalogUnavailableError("Deezer reported an error");
      }
      const parsed = searchBodySchema.safeParse(body);
      if (!parsed.success)
        throw new CatalogUnavailableError("Deezer sent an unexpected answer");
      // One odd entry must not hide the others.
      return parsed.data.data.flatMap((raw) => toTrack(raw) ?? []);
    },

    async getTrack(providerTrackId) {
      if (!TRACK_ID.test(providerTrackId)) return null; // cannot exist, and must not reach the URL
      const body = await getJson(`/track/${providerTrackId}`);
      const failure = errorBodySchema.safeParse(body);
      if (failure.success) {
        const code = failure.data.error.code;
        if (code === DEEZER_NO_DATA || code === DEEZER_INVALID_QUERY) return null;
        throw new CatalogUnavailableError("Deezer reported an error"); // quota, outage, ...
      }
      const track = toTrack(body);
      if (!track) throw new CatalogUnavailableError("Deezer sent an unusable track");
      return track;
    },
  };
}
