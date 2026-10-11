import type { Candle, MarketRegime, RegimeReport } from "@/lib/gold/types";
import { BASELINE_CONFIG, type IndicatorConfig } from "@/lib/gold/configEngine";
import { rsiSeries, macdSeries, volumeSignal } from "@/lib/gold/indicators";

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  values.forEach((v, i) => {
    out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k));
  });
  return out;
}

function trueRanges(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
}

function atrSeries(candles: Candle[], period = 14): number[] {
  const tr = trueRanges(candles);
  return ema(tr, period);
}

// Wilder's DMI/ADX — standard formulation.
function adxSeries(candles: Candle[], period = 14): number[] {
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const tr = trueRanges(candles);
  const smTr = ema(tr, period);
  const smPlus = ema(plusDM, period);
  const smMinus = ema(minusDM, period);

  const dx: number[] = candles.map((_, i) => {
    const plusDi = smTr[i] === 0 ? 0 : (smPlus[i] / smTr[i]) * 100;
    const minusDi = smTr[i] === 0 ? 0 : (smMinus[i] / smTr[i]) * 100;
    const sum = plusDi + minusDi;
    return sum === 0 ? 0 : (Math.abs(plusDi - minusDi) / sum) * 100;
  });
  return ema(dx, period);
}

function percentile(value: number, series: number[]): number {
  if (series.length === 0) return 50;
  const below = series.filter((v) => v <= value).length;
  return Math.round((below / series.length) * 100);
}

/**
 * Deterministic regime classifier — ATR/ADX/EMA-structure/volatility
 * percentile combined, not any single indicator (per design intent: no
 * one signal should decide the regime alone).
 */
export function classifyRegime(candles: Candle[], config: IndicatorConfig = BASELINE_CONFIG): RegimeReport | null {
  if (candles.length < 30) return null;

  const closes = candles.map((c) => c.close);
  const atrs = atrSeries(candles, config.atrPeriod);
  const adxs = adxSeries(candles, config.adxPeriod);
  const emaFastSeries = ema(closes, config.emaFast);
  const emaMedSeries = ema(closes, config.emaMedium);
  const emaSlowSeries = ema(closes, config.emaSlow);

  const atr = atrs[atrs.length - 1];
  const adx = adxs[adxs.length - 1];
  const emaFast = emaFastSeries[emaFastSeries.length - 1];
  const emaMedium = emaMedSeries[emaMedSeries.length - 1];
  const emaSlow = emaSlowSeries[emaSlowSeries.length - 1];
  const atrPercentile = percentile(atr, atrs.slice(-Math.min(100, atrs.length)));

  const price = closes[closes.length - 1];
  const bullStack = emaFast > emaMedium && emaMedium > emaSlow;
  const bearStack = emaFast < emaMedium && emaMedium < emaSlow;
  const range = Math.max(...candles.slice(-20).map((c) => c.high)) - Math.min(...candles.slice(-20).map((c) => c.low));
  const compressed = atrPercentile < 20 && range < atr * 6;

  const reasoning: string[] = [];
  let regime: MarketRegime;

  if (atrPercentile > 90) {
    regime = "extreme_volatility";
    reasoning.push(`ATR في المئين ${atrPercentile} — تقلب شديد غير معتاد.`);
  } else if (atrPercentile > 75) {
    regime = "high_volatility";
    reasoning.push(`ATR مرتفع نسبياً (المئين ${atrPercentile}).`);
  } else if (compressed) {
    regime = "compression";
    reasoning.push("تقلب منخفض ونطاق سعري ضيق — احتمال تجميع قبل حركة.");
  } else if (adx >= 25 && bullStack) {
    regime = "strong_bull_trend";
    reasoning.push(`ADX قوي (${adx.toFixed(1)}) مع ترتيب EMA صاعد (${config.emaFast}>${config.emaMedium}>${config.emaSlow}).`);
  } else if (adx >= 18 && bullStack) {
    regime = "weak_bull_trend";
    reasoning.push(`ADX معتدل (${adx.toFixed(1)}) مع ترتيب EMA صاعد.`);
  } else if (adx >= 25 && bearStack) {
    regime = "strong_bear_trend";
    reasoning.push(`ADX قوي (${adx.toFixed(1)}) مع ترتيب EMA هابط (${config.emaFast}<${config.emaMedium}<${config.emaSlow}).`);
  } else if (adx >= 18 && bearStack) {
    regime = "weak_bear_trend";
    reasoning.push(`ADX معتدل (${adx.toFixed(1)}) مع ترتيب EMA هابط.`);
  } else if (adx < 18 && !bullStack && !bearStack) {
    regime = "range";
    reasoning.push(`ADX ضعيف (${adx.toFixed(1)}) وEMA غير مرتبة — نطاق تذبذب.`);
  } else {
    regime = "unclear";
    reasoning.push("إشارات ADX/EMA متضاربة — لا يوجد نظام سوق واضح.");
  }

  reasoning.push(`السعر مقابل EMA${config.emaSlow}: ${price > emaSlow ? "فوقه" : "تحته"}.`);

  const rsis = rsiSeries(candles, config.rsiPeriod);
  const rsi = rsis[rsis.length - 1];

  const macdRaw = macdSeries(candles, config.macdFast, config.macdSlow, config.macdSignal);
  const lastMacd = macdRaw.line[macdRaw.line.length - 1];
  const lastSignal = macdRaw.signalLine[macdRaw.signalLine.length - 1];
  const lastHist = macdRaw.histogram[macdRaw.histogram.length - 1];
  const prevHist = macdRaw.histogram[macdRaw.histogram.length - 2];
  const macd =
    lastMacd != null && lastSignal != null && lastHist != null
      ? { line: lastMacd, signalLine: lastSignal, histogram: lastHist, histogramRising: prevHist != null ? lastHist > prevHist : false }
      : null;

  const volume = volumeSignal(candles);

  return { regime, atr, atrPercentile, adx, emaFast, emaMedium, emaSlow, rsi, macd, volume, reasoning };
}
