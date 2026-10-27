// What the phone keeps for offline use (ADR-049): the last answers it showed, with when they were
// saved, and the user they belong to. The server stays the source of truth: this is only shown
// while it cannot be reached, and replaced by its answer as soon as it can. Everything is wiped on
// sign-out. SECURITY: the private profile block (phone, birth date) is never stored here.

/** The few calls of AsyncStorage this needs (tests pass a Map). */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

export interface Cached<T> {
  data: T;
  /** When it was saved: shown as "updated 14:32". */
  savedAt: string;
}

export const OFFLINE_PREFIX = "offline:v1:";

export function createOfflineStore(storage: KeyValueStorage, now = () => new Date()) {
  const key = (name: string) => `${OFFLINE_PREFIX}${name}`;

  return {
    /** Never throws: a broken or missing entry is simply nothing cached. */
    async read<T>(name: string): Promise<Cached<T> | null> {
      try {
        const raw = await storage.getItem(key(name));
        if (raw === null) return null;
        const parsed = JSON.parse(raw) as Cached<T>;
        return typeof parsed?.savedAt === "string" && "data" in parsed ? parsed : null;
      } catch (error) {
        console.warn(`Offline copy of ${name} could not be read:`, error);
        return null;
      }
    },

    /** Never throws: without a copy the app still works online. */
    async write<T>(name: string, data: T): Promise<void> {
      try {
        const entry: Cached<T> = { data, savedAt: now().toISOString() };
        await storage.setItem(key(name), JSON.stringify(entry));
      } catch (error) {
        console.warn(`Offline copy of ${name} could not be saved:`, error);
      }
    },

    async remove(name: string): Promise<void> {
      await storage.removeItem(key(name));
    },

    /** Every offline copy and pending change, for sign-out. Raised if it fails: not hidden. */
    async clear(): Promise<void> {
      const keys = (await storage.getAllKeys()).filter((k) =>
        k.startsWith(OFFLINE_PREFIX),
      );
      if (keys.length > 0) await storage.multiRemove(keys);
    },
  };
}

export type OfflineStore = ReturnType<typeof createOfflineStore>;
