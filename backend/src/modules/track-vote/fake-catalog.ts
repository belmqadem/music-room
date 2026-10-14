import type { Track } from "@music-room/shared";
import { CatalogUnavailableError, type CatalogProvider } from "./catalog.js";

// A catalog that needs no network: every numeric id is a track, and a search returns a few
// made-up ones. It exists for LOAD TESTS (we must not hammer Deezer, and we want to measure
// OUR server) and is refused in production by the configuration (CATALOG_PROVIDER=fake is
// rejected when NODE_ENV=production).
const TRACK_ID = /^\d{1,15}$/;

function trackFor(id: string): Track {
  return {
    providerTrackId: id,
    title: `Fake track ${id}`,
    artist: "Fake artist",
    durationSeconds: 180 + (Number(id) % 120),
    coverUrl: null,
  };
}

export function createFakeCatalog(): CatalogProvider {
  return {
    async search(query, limit) {
      const count = Math.min(Math.max(Math.trunc(limit), 1), 25);
      return Array.from({ length: count }, (_, index) => ({
        ...trackFor(String(1000 + index)),
        title: `${query} (fake result ${index + 1})`,
      }));
    },

    async getTrack(providerTrackId) {
      if (providerTrackId === "0") return null; // so tests can still try "unknown track"
      if (providerTrackId === "999999999")
        throw new CatalogUnavailableError("fake outage");
      return TRACK_ID.test(providerTrackId) ? trackFor(providerTrackId) : null;
    },
  };
}
