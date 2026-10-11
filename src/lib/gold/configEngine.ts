// Three-tier configuration system. The critical rule this file exists to
// enforce: nothing gets labeled VALIDATED without real out-of-sample
// evidence, and until that evidence exists the selector always falls
// back to an EXPERT BASELINE — a defensible, conventional starting
// profile — never an invented "optimized" value. Expert baseline and
// validated are never the same thing, and the UI must never blur them.

export type ConfigStatus = "BASELINE" | "CANDIDATE" | "VALIDATED" | "DEGRADED" | "REJECTED" | "INSUFFICIENT_DATA";
export type ConfigConfidence = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

export type IndicatorConfig = {
  atrPeriod: number;
  adxPeriod: number;
  emaFast: number;
  emaMedium: number;
  emaSlow: number;
  // Captured for future use but NOT currently read by the regime/structure
  // engines — being explicit about this rather than implying every field
  // here actually drives a calculation today.
  emaMajor: number;
  rsiPeriod: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  bbPeriod: number;
  bbDeviation: number;
};

// Two expert-conventional groupings — faster/more responsive for the
// lower execution timeframes, slower/standard for the higher structural
// timeframes. This is established, defensible TA practice (not a claim
// of validated superiority): RSI(9) and a faster MACD(8,17,9) are
// commonly cited "fast" oscillator variants for intraday/scalping
// timeframes, same rationale as the shorter EMA grouping below. ATR/ADX/BB
// stay identical across both — there's no comparably well-known
// convention for varying those by timeframe tier.
const SHARED: Omit<IndicatorConfig, "emaFast" | "emaMedium" | "emaSlow" | "rsiPeriod" | "macdFast" | "macdSlow" | "macdSignal"> = {
  atrPeriod: 14,
  adxPeriod: 14,
  emaMajor: 200,
  bbPeriod: 20,
  bbDeviation: 2,
};

export const FAST_TF_CONFIG: IndicatorConfig = { ...SHARED, emaFast: 9, emaMedium: 21, emaSlow: 50, rsiPeriod: 9, macdFast: 8, macdSlow: 17, macdSignal: 9 };
export const SLOW_TF_CONFIG: IndicatorConfig = { ...SHARED, emaFast: 20, emaMedium: 50, emaSlow: 100, rsiPeriod: 14, macdFast: 12, macdSlow: 26, macdSignal: 9 };
export const BASELINE_CONFIG = FAST_TF_CONFIG; // default export used wherever no timeframe context exists (e.g. backtest's daily resample)

const FAST_TIMEFRAMES = new Set(["5M", "15M"]);

// Config-registry regime buckets — coarser than the full MarketRegime
// union on purpose: the expert reasoning here only distinguishes trend
// vs range vs pre-breakout compression vs high-volatility caution, not
// every regime nuance, since finer distinctions without evidence would
// just be more invented granularity.
export type RegimeBucket = "ANY" | "TREND" | "RANGE" | "COMPRESSION" | "HIGH_VOL";

const REGIME_STRATEGY_LABEL: Record<RegimeBucket, string> = {
  ANY: "خط أساس عام",
  TREND: "اتجاه + ارتداد (Trend Following + Pullback)",
  RANGE: "ارتداد من نطاق (Mean Reversion + Liquidity Extremes)",
  COMPRESSION: "مراقبة اختراق (Breakout Compression Watch)",
  HIGH_VOL: "حذر تقلب مرتفع (Volatility Caution)",
};

export function regimeToBucket(regime: string | undefined | null): RegimeBucket {
  if (!regime) return "ANY";
  if (regime.includes("trend")) return "TREND";
  if (regime === "range") return "RANGE";
  if (regime === "compression" || regime === "breakout") return "COMPRESSION";
  if (regime === "high_volatility" || regime === "extreme_volatility") return "HIGH_VOL";
  return "ANY";
}

export type ConfigProfile = {
  id: string;
  timeframe: string;
  regime: RegimeBucket;
  strategyLabel: string;
  status: ConfigStatus;
  confidence: ConfigConfidence;
  params: IndicatorConfig;
  sampleTrades: number;
  outOfSamplePF: number | null;
  outOfSampleExpectancy: number | null;
  maxDrawdownPct: number | null;
  createdAt: number;
  lastValidatedAt: number | null;
  notes: string[];
};

const NOW = Date.now();

function expertBaselineProfile(timeframe: string, regime: RegimeBucket): ConfigProfile {
  const params = FAST_TIMEFRAMES.has(timeframe) ? FAST_TF_CONFIG : SLOW_TF_CONFIG;
  return {
    id: `CONFIG-${timeframe}-${regime}-EXPERT`,
    timeframe,
    regime,
    strategyLabel: REGIME_STRATEGY_LABEL[regime],
    status: "BASELINE",
    confidence: "INSUFFICIENT",
    params,
    sampleTrades: 0,
    outOfSamplePF: null,
    outOfSampleExpectancy: null,
    maxDrawdownPct: null,
    createdAt: NOW,
    lastValidatedAt: null,
    notes: [
      regime === "ANY"
        ? "بداية خبير عامة (Expert Baseline) — قيم تقليدية معروفة، ليست محسّنة إحصائياً على بياناتنا."
        : `بداية خبير مخصصة لنظام السوق "${regime}" (Expert Baseline) — نفس أرقام المؤشرات القياسية مع تركيز استراتيجي مختلف حسب النظام، وليست قيماً محسّنة إحصائياً بعد.`,
    ],
  };
}

// No CANDIDATE or VALIDATED entries exist yet, on purpose — that would
// require walk-forward optimization against a real out-of-sample dataset
// far larger than what the free-tier data depth currently provides. Every
// entry here is honestly an EXPERT BASELINE until real evidence promotes
// one specific (timeframe, regime) combination past it.
const TIMEFRAMES = ["5M", "15M", "30M", "1H", "4H", "1D"];
const REGIME_BUCKETS: RegimeBucket[] = ["ANY", "TREND", "RANGE", "COMPRESSION", "HIGH_VOL"];

export const CONFIG_REGISTRY: ConfigProfile[] = TIMEFRAMES.flatMap((tf) => REGIME_BUCKETS.map((regime) => expertBaselineProfile(tf, regime)));

export type ConfigSelection = { config: ConfigProfile; trace: string[] };

/**
 * Hierarchical fallback: try a validated profile first (exact regime,
 * then generic), then an expert-baseline profile (exact regime, then
 * generic), so a real validated config always wins once one exists, and
 * regime-specific expert reasoning is preferred over the fully generic
 * baseline even before anything is validated. The trace documents every
 * step tried, so the diagnostics panel can show its work.
 */
// `registry` defaults to the static in-memory CONFIG_REGISTRY — every
// existing call site (and the whole backtest engine's hot loop, which
// calls this per-candle and can't afford an async Redis read) keeps
// working exactly as before with zero changes. The live decision route is
// the only caller that passes a real registry: one loaded once per
// request from configPersistence.ts's Redis-backed store, so a genuine
// promotion (see evaluatePromotions in configPersistence.ts) actually
// shows up in live decisions instead of only existing inside backtest
// responses.
export function selectConfig(timeframe: string, regime: RegimeBucket | string, registry: ConfigProfile[] = CONFIG_REGISTRY): ConfigSelection {
  const trace: string[] = [];
  const bucket: RegimeBucket = (REGIME_BUCKETS as string[]).includes(regime) ? (regime as RegimeBucket) : regimeToBucket(regime);

  const specificValidated = registry.find((c) => c.timeframe === timeframe && c.regime === bucket && c.status === "VALIDATED");
  if (specificValidated) {
    trace.push(`إعداد محقّق مطابق تماماً: ${timeframe} + ${bucket}.`);
    return { config: specificValidated, trace };
  }
  trace.push(`لا يوجد إعداد محقّق (VALIDATED) لـ ${timeframe} + ${bucket}.`);

  const genericValidated = registry.find((c) => c.timeframe === timeframe && c.regime === "ANY" && c.status === "VALIDATED");
  if (genericValidated) {
    trace.push(`إعداد محقّق عام لفريم ${timeframe} (بدون تخصيص لنظام السوق).`);
    return { config: genericValidated, trace };
  }
  trace.push(`لا يوجد إعداد محقّق عام لفريم ${timeframe}.`);

  const regimeBaseline = registry.find((c) => c.timeframe === timeframe && c.regime === bucket);
  if (regimeBaseline) {
    trace.push(`بداية خبير مخصصة لنظام السوق (Expert Baseline): ${timeframe} + ${bucket}.`);
    return { config: regimeBaseline, trace };
  }
  trace.push(`لا يوجد بداية خبير مخصصة لنظام السوق ${bucket} على فريم ${timeframe}.`);

  const genericBaseline = registry.find((c) => c.timeframe === timeframe && c.regime === "ANY");
  if (genericBaseline) {
    trace.push(`الرجوع لبداية الخبير العامة (Expert Baseline) لفريم ${timeframe}.`);
    return { config: genericBaseline, trace };
  }

  trace.push("فريم غير معروف — الرجوع للإعداد الأساسي العام.");
  return { config: expertBaselineProfile(timeframe, "ANY"), trace };
}
