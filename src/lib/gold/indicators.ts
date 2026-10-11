import type { Candle } from "@/lib/gold/types";

function emaOf(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  values.forEach((v, i) => {
    out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k));
  });
  return out;
}

/**
 * Wilder's RSI (the standard formulation — smoothed average gain/loss,
 * not a simple moving average of gains/losses). Returns the full series
 * so the caller can look at recent history, not just the latest value.
 */
export function rsiSeries(candles: Candle[], period = 14): (number | null)[] {
  if (candles.length < period + 1) return candles.map(() => null);

  const closes = candles.map((c) => c.close);
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(Math.max(0, change));
    losses.push(Math.max(0, -change));
  }

  const out: (number | null)[] = new Array(closes.length).fill(null);
  let avgGain = gains.slice(1, period + 1).reduce((s, v) => s + v, 0) / period;
  let avgLoss = losses.slice(1, period + 1).reduce((s, v) => s + v, 0) / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/**
 * Standard MACD: fast EMA minus slow EMA, a signal EMA of that line, and
 * the histogram (line minus signal). Returns full series so the caller
 * can compare the latest value against its own recent trend (e.g. "is
 * the histogram growing or shrinking"), not just a single snapshot.
 */
export function macdSeries(
  candles: Candle[],
  fast = 12,
  slow = 26,
  signal = 9
): { line: (number | null)[]; signalLine: (number | null)[]; histogram: (number | null)[] } {
  const closes = candles.map((c) => c.close);
  if (closes.length < slow + signal) {
    const nulls = candles.map(() => null);
    return { line: nulls, signalLine: nulls, histogram: nulls };
  }

  const emaFast = emaOf(closes, fast);
  const emaSlow = emaOf(closes, slow);
  const line = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = emaOf(line, signal);
  const histogram = line.map((v, i) => v - signalLine[i]);

  return { line, signalLine, histogram };
}

export type Divergence = { type: "bullish" | "bearish" | "none"; note: string | null };

function localExtremaIndices(values: number[], kind: "peak" | "trough"): number[] {
  const idxs: number[] = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (kind === "peak" && values[i] > values[i - 1] && values[i] > values[i + 1]) idxs.push(i);
    if (kind === "trough" && values[i] < values[i - 1] && values[i] < values[i + 1]) idxs.push(i);
  }
  return idxs;
}

/**
 * Classic RSI divergence: price makes a new extreme but RSI doesn't
 * confirm it — momentum is quietly weakening even though price is still
 * pushing in the same direction. A real, standard confirmation technique
 * (distinct from the RSI level itself, which regime.ts already surfaces)
 * that gold-trading references consistently list alongside EMA/MACD as
 * part of a serious setup, not a fringe indicator.
 *
 * Compares the CURRENT bar — which may still be in the middle of making
 * a fresh high/low, not yet a confirmed reversal — against the most
 * recent CONFIRMED prior local peak/trough. Comparing two already-
 * confirmed extrema would only ever catch a divergence after price has
 * already rolled over, which is exactly the moment it stops being
 * actionable; checking "now" against the last confirmed swing catches it
 * while the move is still forming.
 */
export function detectRsiDivergence(candles: Candle[], rsiPeriod: number, lookback = 40): Divergence {
  if (candles.length < lookback + rsiPeriod + 5) return { type: "none", note: null };

  const rsiFull = rsiSeries(candles, rsiPeriod);
  const window = candles.slice(-lookback);
  const rsiWindow = rsiFull.slice(-lookback);
  if (rsiWindow.some((v) => v == null)) return { type: "none", note: null };

  const closes = window.map((c) => c.close);
  const rsi = rsiWindow as number[];
  const lastIdx = closes.length - 1;
  // Search for confirmed extrema in history excluding the last couple of
  // bars (which haven't had a chance to be confirmed by a reversal yet).
  const history = closes.slice(0, lastIdx);

  // Noise guards: a real divergence is a distinct swing with a real gap,
  // not two adjacent bars in a zigzag that happen to differ by a
  // fraction of an RSI point. Without these, this fires constantly on
  // pure chop — adding noise instead of filtering it, which defeats the
  // entire point of a confirmation signal.
  const MIN_BARS_SINCE_EXTREMUM = 5;
  const MIN_RSI_GAP = 4;
  const MIN_PRICE_GAP_PCT = 0.05; // 0.05% of price — filters flat/tied comparisons

  const priorPeaks = localExtremaIndices(history, "peak").filter((i) => lastIdx - i >= MIN_BARS_SINCE_EXTREMUM);
  if (priorPeaks.length > 0) {
    const p = priorPeaks[priorPeaks.length - 1];
    const priceGapPct = ((closes[lastIdx] - closes[p]) / closes[p]) * 100;
    if (priceGapPct >= MIN_PRICE_GAP_PCT && rsi[p] - rsi[lastIdx] >= MIN_RSI_GAP) {
      return {
        type: "bearish",
        note: "تباعد سلبي (Bearish Divergence): السعر عند قمة جديدة أعلى من آخر قمة مؤكدة، بس RSI أضعف بوضوح من وقتها — الزخم الصاعد يضعف رغم استمرار ارتفاع السعر.",
      };
    }
  }

  const priorTroughs = localExtremaIndices(history, "trough").filter((i) => lastIdx - i >= MIN_BARS_SINCE_EXTREMUM);
  if (priorTroughs.length > 0) {
    const t = priorTroughs[priorTroughs.length - 1];
    const priceGapPct = ((closes[t] - closes[lastIdx]) / closes[t]) * 100;
    if (priceGapPct >= MIN_PRICE_GAP_PCT && rsi[lastIdx] - rsi[t] >= MIN_RSI_GAP) {
      return {
        type: "bullish",
        note: "تباعد إيجابي (Bullish Divergence): السعر عند قاع جديد أدنى من آخر قاع مؤكد، بس RSI أقوى بوضوح من وقتها — الزخم الهابط يضعف رغم استمرار انخفاض السعر.",
      };
    }
  }

  return { type: "none", note: null };
}

/**
 * Real exchange volume doesn't exist for a spot forex-style instrument
 * like XAU/USD the way it does for a listed stock — there's no single
 * central exchange to total it from. Free-tier providers sometimes
 * return a "tick volume" proxy and sometimes return nothing at all for
 * this symbol. Rather than treat a null/sparse field as zero (which
 * would silently fabricate a "low volume" reading), this reports
 * unavailability honestly when too few recent candles carry a real
 * number.
 */
export function volumeSignal(candles: Candle[], lookback = 20): { available: boolean; relativeToAvg: number | null } {
  const recent = candles.slice(-lookback);
  const withVolume = recent.filter((c) => c.volume != null && c.volume > 0);
  if (withVolume.length < Math.ceil(lookback * 0.7)) return { available: false, relativeToAvg: null };

  const avg = withVolume.reduce((s, c) => s + (c.volume as number), 0) / withVolume.length;
  const last = candles[candles.length - 1].volume;
  if (last == null || avg === 0) return { available: false, relativeToAvg: null };

  return { available: true, relativeToAvg: Number((last / avg).toFixed(2)) };
}
