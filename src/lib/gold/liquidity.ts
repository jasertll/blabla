import type { Candle, LiquidityLevel, LiquidityReport } from "@/lib/gold/types";

// Round numbers ($4300, $4350, $4400...) are a well-documented gold-specific
// pattern — retail and institutional orders alike cluster around them,
// which is why dedicated "round number" indicators exist specifically for
// XAU/USD (unlike most FX pairs, where this effect is weaker). $50 is the
// step gold traders commonly watch; a $100 handle ("رئيسي") tends to draw
// even more attention. This is a real, structural price fact (arithmetic
// on the current price), not a fetched level — it needs no data source and
// can never be "unavailable."
const ROUND_STEP = 50;

function roundNumberLevels(price: number): LiquidityLevel[] {
  const below = Math.floor(price / ROUND_STEP) * ROUND_STEP;
  const above = below + ROUND_STEP;
  return [below, above]
    .filter((level) => level > 0 && level !== price)
    .map((level) => ({
      label: level % 100 === 0 ? `رقم مدوّر رئيسي ($${level})` : `رقم مدوّر ($${level})`,
      price: level,
      kind: level > price ? "high" : "low",
    }));
}

/**
 * Builds a liquidity map from daily candles (prev day/week high-low) plus
 * the current day's session extremes computed from intraday candles, plus
 * round-number magnet levels (see roundNumberLevels above — the only
 * entries here that aren't derived from fetched OHLC, since they need
 * only the current price). Everything else is derived from real fetched
 * data — no fabricated structural levels.
 */
export function analyzeLiquidity(dailyCandles: Candle[], intradayCandles: Candle[], currentPrice: number): LiquidityReport | null {
  if (dailyCandles.length < 2) return null;

  const levels: LiquidityLevel[] = [...roundNumberLevels(currentPrice)];
  const sorted = [...dailyCandles].sort((a, b) => a.time - b.time);
  const prevDay = sorted[sorted.length - 2];
  if (prevDay) {
    levels.push({ label: "قمة اليوم السابق (PDH)", price: prevDay.high, kind: "high" });
    levels.push({ label: "قاع اليوم السابق (PDL)", price: prevDay.low, kind: "low" });
  }

  if (sorted.length >= 7) {
    const lastWeek = sorted.slice(-7, -1);
    const weekHigh = Math.max(...lastWeek.map((c) => c.high));
    const weekLow = Math.min(...lastWeek.map((c) => c.low));
    levels.push({ label: "قمة الأسبوع السابق (PWH)", price: weekHigh, kind: "high" });
    levels.push({ label: "قاع الأسبوع السابق (PWL)", price: weekLow, kind: "low" });
  }

  if (intradayCandles.length > 0) {
    const dayMs = 24 * 60 * 60 * 1000;
    const latestTime = intradayCandles[intradayCandles.length - 1].time;
    const dayStart = latestTime - (latestTime % dayMs);
    const todaysCandles = intradayCandles.filter((c) => c.time >= dayStart);
    if (todaysCandles.length > 0) {
      levels.push({ label: "قمة الجلسة الحالية", price: Math.max(...todaysCandles.map((c) => c.high)), kind: "high" });
      levels.push({ label: "قاع الجلسة الحالية", price: Math.min(...todaysCandles.map((c) => c.low)), kind: "low" });
    }
  }

  const above = levels.filter((l) => l.price > currentPrice).sort((a, b) => a.price - b.price);
  const below = levels.filter((l) => l.price < currentPrice).sort((a, b) => b.price - a.price);

  return { levels, nearestAbove: above[0] ?? null, nearestBelow: below[0] ?? null };
}
