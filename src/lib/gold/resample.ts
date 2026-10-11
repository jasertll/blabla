import type { Candle } from "@/lib/gold/types";

/**
 * Aggregates consecutive base-timeframe candles into a synthetic higher
 * timeframe (e.g. 4x 1H -> one 4H bar). Used both by the backtest engine
 * (building 15M/30M/1H/4H from a single bulk 5M fetch, instead of burning
 * free-tier credits on a separate historical pull per timeframe) and by
 * the Finnhub provider (synthesizing 4H candles, which Finnhub's free
 * forex/candle endpoint has no native resolution for, from 1H bars).
 * Boundary alignment isn't guaranteed to match the exchange's actual bar
 * boundaries — callers should disclose that rather than hide it.
 */
export function resampleCandles(candles: Candle[], factor: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i + factor <= candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    out.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.some((c) => c.volume != null) ? chunk.reduce((s, c) => s + (c.volume ?? 0), 0) : null,
    });
  }
  return out;
}
