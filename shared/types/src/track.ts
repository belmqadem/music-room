// API contract: a music track as shown to the app. Owner: belmqadem. Changes need review from BOTH developers.
// The backend resolves these fields from the music catalog; the client only ever sends `providerTrackId`.
// TODO(contract): catalog provider (see docs/architecture-decisions.md, "Still to decide").

export interface Track {
  providerTrackId: string;
  title: string;
  artist: string;
  durationSeconds: number;
  coverUrl: string | null;
}
