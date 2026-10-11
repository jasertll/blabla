import type { Candle, StructureReport, SwingPoint } from "@/lib/gold/types";
import { classifyRegime } from "@/lib/gold/regime";
import { BASELINE_CONFIG, type IndicatorConfig } from "@/lib/gold/configEngine";

/**
 * Fractal-style swing detection: a candle at index i is a swing high if its
 * high is the max within a `lookaround`-candle window on both sides (and
 * symmetrically for swing lows). ATR-scaled minimum prominence avoids
 * flagging noise as structure (per design intent: don't treat insignificant
 * candle movements as BOS).
 */
function detectSwings(candles: Candle[], lookaround = 3): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookaround; i < candles.length - lookaround; i++) {
    const window = candles.slice(i - lookaround, i + lookaround + 1);
    const c = candles[i];
    if (c.high === Math.max(...window.map((w) => w.high))) {
      swings.push({ time: c.time, price: c.high, kind: "high" });
    } else if (c.low === Math.min(...window.map((w) => w.low))) {
      swings.push({ time: c.time, price: c.low, kind: "low" });
    }
  }
  return swings;
}

function classifySequence(swings: SwingPoint[]): ("HH" | "HL" | "LH" | "LL")[] {
  const sequence: ("HH" | "HL" | "LH" | "LL")[] = [];
  const highs = swings.filter((s) => s.kind === "high");
  const lows = swings.filter((s) => s.kind === "low");

  for (let i = 1; i < highs.length; i++) {
    sequence.push(highs[i].price > highs[i - 1].price ? "HH" : "LH");
  }
  for (let i = 1; i < lows.length; i++) {
    sequence.push(lows[i].price > lows[i - 1].price ? "HL" : "LL");
  }
  return sequence;
}

export function analyzeStructure(candles: Candle[], config: IndicatorConfig = BASELINE_CONFIG): StructureReport | null {
  if (candles.length < 20) return null;

  const regime = classifyRegime(candles, config);
  const atr = regime?.atr ?? (Math.max(...candles.map((c) => c.high)) - Math.min(...candles.map((c) => c.low))) / candles.length;

  const swings = detectSwings(candles, 3);
  const sequence = classifySequence(swings);

  const reasoning: string[] = [];
  const hhCount = sequence.filter((s) => s === "HH").length;
  const hlCount = sequence.filter((s) => s === "HL").length;
  const lhCount = sequence.filter((s) => s === "LH").length;
  const llCount = sequence.filter((s) => s === "LL").length;

  const bullScore = hhCount + hlCount;
  const bearScore = lhCount + llCount;
  let bias: "bullish" | "bearish" | "neutral" = "neutral";
  if (bullScore > bearScore + 1) bias = "bullish";
  else if (bearScore > bullScore + 1) bias = "bearish";

  reasoning.push(`تسلسل القمم/القيعان الأخير: ${sequence.slice(-6).join(", ") || "غير كافٍ"}.`);

  // BOS: most recent swing high broken by a later close (bullish), or most
  // recent swing low broken by a later close (bearish) — displacement must
  // exceed a fraction of ATR to filter noise.
  let lastBOS: StructureReport["lastBOS"] = null;
  const highs = swings.filter((s) => s.kind === "high");
  const lows = swings.filter((s) => s.kind === "low");
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  const minDisplacement = atr * 0.3;

  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    if (lastHigh && c.time > lastHigh.time && c.close > lastHigh.price + minDisplacement) {
      lastBOS = { direction: "bullish", time: c.time, level: lastHigh.price };
      break;
    }
    if (lastLow && c.time > lastLow.time && c.close < lastLow.price - minDisplacement) {
      lastBOS = { direction: "bearish", time: c.time, level: lastLow.price };
      break;
    }
  }

  if (lastBOS) {
    reasoning.push(
      lastBOS.direction === "bullish"
        ? `كسر هيكلي صاعد (BOS) فوق ${lastBOS.level.toFixed(2)}.`
        : `كسر هيكلي هابط (BOS) تحت ${lastBOS.level.toFixed(2)}.`
    );
  } else {
    reasoning.push("لا يوجد كسر هيكلي حديث مؤكد.");
  }

  return { swings, sequence, lastBOS, bias, reasoning };
}
