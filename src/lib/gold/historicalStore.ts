import { getRedis } from "@/lib/redis";
import type { Candle, Timeframe } from "@/lib/gold/types";

// Durable historical accumulation, on top of the already-configured
// Upstash Redis (no new account/service needed — reuses the same
// UPSTASH_REDIS_REST_URL/TOKEN the visitor counter already uses). This is
// what actually solves "not enough candles" for good: every backtest run
// merges its freshly fetched deep-paginated window into this store, so
// history genuinely accumulates day over day instead of resetting to
// whatever a single provider request/pagination run can reach. If Redis
// isn't configured, every function here degrades to "no persistence" —
// same honest fallback pattern as the rest of this app — and the caller
// just gets back the fresh fetch unchanged.
//
// Only the 4H/1H/30M/15M base is NOT what's stored here — this only ever
// persists 5M candles (the backtest engine's own base series). Every
// other timeframe is derived from 5M via resample.ts, live and in the
// backtest, so storing them separately would just be redundant data with
// its own drift risk.
const STORE_TIMEFRAME: Timeframe = "5min";
const KEY = `gold:candles:v1:${STORE_TIMEFRAME}`;

// Bounded, not "grow forever" — Upstash's free/pay-as-you-go tiers have
// real per-request payload and storage ceilings, and a single sorted set
// holding years of 5-minute XAU/USD bars would eventually bump into them.
// 270 days (~9 months) comfortably clears this app's own 60-day evidence
// gate and gets most of the way to the spec's "6-12 months" target
// without gambling on free-tier storage limits — a size-driven ceiling,
// disclosed honestly rather than silently capped.
const MAX_SPAN_MS = 270 * 24 * 60 * 60_000;

// Upstash's REST API has a practical per-request payload ceiling; batching
// keeps any single zadd call small regardless of how many candles a deep
// pagination run returns (up to 30,000 in one run).
const WRITE_BATCH_SIZE = 500;

export type StoreStatus = { configured: boolean; timeframe: Timeframe };

export function historicalStoreStatus(): StoreStatus {
  return { configured: getRedis() != null, timeframe: STORE_TIMEFRAME };
}

/**
 * Merges freshly fetched 5M candles into the durable store (dedup by
 * timestamp: the incoming window is cleared first, then re-written, so a
 * re-fetched overlapping page can never double a bar) and returns the
 * FULL accumulated series read back from Redis, trimmed to MAX_SPAN_MS.
 * If Redis isn't configured, or the merge itself fails for any reason,
 * this returns `fresh` unchanged — a Redis hiccup degrades to today's
 * behavior, it never breaks the backtest.
 */
export async function accumulateCandles(fresh: Candle[]): Promise<Candle[]> {
  const redis = getRedis();
  if (!redis || fresh.length === 0) return fresh;

  try {
    const sorted = [...fresh].sort((a, b) => a.time - b.time);
    const minTime = sorted[0].time;
    const maxTime = sorted[sorted.length - 1].time;

    await redis.zremrangebyscore(KEY, minTime, maxTime);

    for (let i = 0; i < sorted.length; i += WRITE_BATCH_SIZE) {
      const batch = sorted.slice(i, i + WRITE_BATCH_SIZE);
      const members = batch.map((c) => ({ score: c.time, member: JSON.stringify(c) }));
      await redis.zadd(KEY, members[0], ...members.slice(1));
    }

    const cutoff = Date.now() - MAX_SPAN_MS;
    await redis.zremrangebyscore(KEY, 0, cutoff);

    return await readAccumulated();
  } catch {
    return fresh;
  }
}

/** Reads the full accumulated series back, sorted ascending by time. */
export async function readAccumulated(): Promise<Candle[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.zrange<string[]>(KEY, 0, Date.now(), { byScore: true });
    return raw.map((s) => JSON.parse(s) as Candle).sort((a, b) => a.time - b.time);
  } catch {
    return [];
  }
}
