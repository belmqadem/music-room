// API contract: a music track as shown to the app. Owner: belmqadem. Changes need review from BOTH developers.
// The backend resolves these fields from the music catalog; the client only ever sends `providerTrackId`.
// The catalog is Deezer's public API (ADR-015). Everything here is a snapshot taken when the track was suggested.
// Titles and artists come from a third party: never render them as HTML.

export interface Track {
  providerTrackId: string;
  title: string;
  artist: string;
  durationSeconds: number;
  coverUrl: string | null;
}

/**
 * GET /tracks/{providerTrackId}/preview: a 30-second sample of the track (ADR-053). The link is
 * signed by the catalog and expires within minutes, so fetch it when the person presses play,
 * never store it. Only https links on the catalog's own audio host are ever returned.
 */
export interface TrackPreview {
  url: string;
}
