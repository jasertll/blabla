type CacheEntry<T> = { value: T; expiresAt: number };

const store = new Map<string, CacheEntry<unknown>>();

/**
 * Minimal in-memory TTL cache shared across API routes within one
 * server process. Good enough for a single-instance deployment;
 * swap for Redis if you run multiple instances behind a load balancer.
 */
export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export const TTL = {
  ONE_MINUTE: 60_000,
  FIVE_MINUTES: 5 * 60_000,
  ONE_HOUR: 60 * 60_000,
};

const inFlight = new Map<string, Promise<unknown>>();
const lastGood = new Map<string, { value: unknown; at: number }>();

export type CacheFetchResult<T> = { value: T; stale: boolean };

/**
 * TTL cache read, with in-flight request coalescing on a miss and a
 * stale-data fallback on failure. Coalescing: several requests landing
 * at once for the same cold key (e.g. the gold engine's cross-timeframe
 * comparison firing 5 parallel decision calls that all need the same
 * candle series) each independently seeing an empty cache and firing
 * their own provider fetch would multiply real upstream API calls for
 * data that's about to be identical anyway — exactly what trips a
 * free-tier provider's per-minute rate limit. Stale fallback: when a
 * fresh fetch itself fails (e.g. that same rate limit), returning the
 * last real data this process successfully fetched — clearly flagged
 * `stale: true` so the caller can disclose it — beats hard-failing the
 * whole decision to "no data" every time the provider hiccups. Past
 * `maxStaleMs` the fallback is treated as too old to be honest and is
 * dropped, same as if there were no fallback at all.
 */
export async function cacheGetOrFetch<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  shouldCache: (value: T) => boolean = () => true,
  maxStaleMs: number = 15 * 60_000
): Promise<CacheFetchResult<T>> {
  const cached = cacheGet<T>(key);
  if (cached !== undefined) return { value: cached, stale: false };

  const existing = inFlight.get(key);
  if (existing) return existing as Promise<CacheFetchResult<T>>;

  const promise = (async (): Promise<CacheFetchResult<T>> => {
    try {
      const result = await fetcher();
      if (shouldCache(result)) {
        cacheSet(key, result, ttlMs);
        lastGood.set(key, { value: result, at: Date.now() });
        return { value: result, stale: false };
      }
      const fallback = lastGood.get(key);
      if (fallback && Date.now() - fallback.at <= maxStaleMs) {
        return { value: fallback.value as T, stale: true };
      }
      return { value: result, stale: false };
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}
