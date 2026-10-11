import type {
  Candle,
  Decision,
  GoldDecisionOutput,
  LiquidityReport,
  RegimeReport,
  StructureReport,
  TradeQuality,
} from "@/lib/gold/types";
import { classifyRegime } from "@/lib/gold/regime";
import { analyzeStructure } from "@/lib/gold/structure";
import { analyzeLiquidity } from "@/lib/gold/liquidity";
import { analyzeSessions } from "@/lib/gold/sessions";
import { selectConfig, regimeToBucket, CONFIG_REGISTRY, type ConfigStatus, type ConfigConfidence, type ConfigProfile, type IndicatorConfig } from "@/lib/gold/configEngine";
import type { NewsRiskAssessment } from "@/lib/gold/newsRisk";
import { detectRsiDivergence } from "@/lib/gold/indicators";
import { nearGoldFixWindow } from "@/lib/gold/goldFix";

export type TimeframeAnalysis = { regime: RegimeReport | null; structure: StructureReport | null; rsiPeriod: number | null };

export type ConfigTraceEntry = {
  timeframe: string;
  configId: string;
  strategyLabel: string;
  status: ConfigStatus;
  confidence: ConfigConfidence;
  params: IndicatorConfig;
  selectionSteps: string[];
};

const NO_NEWS_DATA: NewsRiskAssessment = { level: "unavailable", nextEvent: null, minutesUntil: null, inBlackout: false, blackoutReason: null };

export type DecisionInput = {
  price: number | null;
  // The provider's own timestamp for `price` — see GoldDecisionOutput.priceAsOf.
  priceAsOf?: number | null;
  candles4h: Candle[] | null;
  candles1h: Candle[] | null;
  candles30m: Candle[] | null;
  candles15m: Candle[] | null;
  candles5m: Candle[] | null;
  dailyCandles: Candle[] | null;
  macro: { us10yTrend: "up" | "down" | "flat" | null; dxyTrend: "up" | "down" | "flat" | null };
  dataIssues: string[];
  // Optional — omitted by the backtest engine (no historical news feed),
  // which just means no blackout is ever applied during a backtest run.
  // That asymmetry vs. live trading is called out in the backtest's own caveats.
  newsRisk?: NewsRiskAssessment;
  // Which timeframe's ATR/EMA/structure anchors the entry zone, SL, TP,
  // and quality gates. Defaults to 15M. The other four timeframes are
  // still fully analyzed and still vote on the 5-way confluence either
  // way — this only changes which one's structure defines "the trade."
  primaryTimeframe?: "4H" | "1H" | "30M" | "15M" | "5M";
  // Defaults to the static expert-baseline CONFIG_REGISTRY — the backtest
  // engine's hot loop always uses that default (it can't afford an async
  // Redis read per simulated candle). The live decision route is the one
  // caller that loads the real Redis-persisted registry once per request
  // (see configPersistence.ts) and passes it here, so an actual promotion
  // shows up in live decisions, not just in backtest responses.
  configRegistry?: ConfigProfile[];
  // Hard data-quality gate reasons (e.g. "price is critically stale",
  // "two independent price sources disagree beyond tolerance"). Non-empty
  // forces decision="wait"/quality="NO_TRADE" regardless of what the rest
  // of the analysis found — see the dataHealth block below. Distinct from
  // `dataIssues`, which are disclosed but don't block a decision on their
  // own.
  criticalStaleness?: string[];
};

// ADX-based regime and confirmed-swing structure are both lagging by
// construction — ADX needs a full smoothing period of sustained direction
// to register "trending," and a structural HH/HL sequence needs several
// bars of follow-through before a swing counts as "confirmed." On a fast,
// sudden move (say gold running 1%+ in under a day), those can legitimately
// still read "no clear trend yet" well after price has already moved,
// especially on higher timeframes where one indicator period is a long
// wall-clock window (14 bars on 4H is over 2 days). This computes a much
// faster, non-lagging signal — raw price displacement over the last few
// candles relative to ATR — purely so that gap can be explained honestly
// (see its one call site below) rather than leaving "no confluence" as an
// unexplained dead end when it's really "the slow indicators haven't
// caught up to the fast move yet."
function priceMomentum(candles: Candle[] | null, atr: number | null, lookback = 10): { pctMove: number; direction: "bullish" | "bearish" | "neutral" } | null {
  if (!candles || candles.length <= lookback || atr == null || atr <= 0) return null;
  const from = candles[candles.length - 1 - lookback].close;
  const to = candles[candles.length - 1].close;
  const move = to - from;
  const moveInAtr = Math.abs(move) / atr;
  return {
    pctMove: Number(((move / from) * 100).toFixed(2)),
    direction: moveInAtr < 1.5 ? "neutral" : move > 0 ? "bullish" : "bearish",
  };
}

function biasOf(regime: RegimeReport | null, structure: StructureReport | null): "bullish" | "bearish" | "neutral" {
  const votes: ("bullish" | "bearish" | "neutral")[] = [];
  if (regime) {
    if (regime.regime === "strong_bull_trend" || regime.regime === "weak_bull_trend") votes.push("bullish");
    else if (regime.regime === "strong_bear_trend" || regime.regime === "weak_bear_trend") votes.push("bearish");
  }
  if (structure) votes.push(structure.bias);
  const bull = votes.filter((v) => v === "bullish").length;
  const bear = votes.filter((v) => v === "bearish").length;
  if (bull > bear) return "bullish";
  if (bear > bull) return "bearish";
  return "neutral";
}

const TRENDING_REGIMES = new Set(["strong_bull_trend", "weak_bull_trend", "strong_bear_trend", "weak_bear_trend"]);

/**
 * Advisory only — picks whichever execution-relevant timeframe (30M/15M/5M)
 * currently shows the cleanest signal (a real BOS, a trending regime, and
 * agreement with the overall direction), so the user knows where to look
 * for confirmation. Does not change the entry/SL/TP math, which stays
 * anchored to 15M.
 */
function pickRecommendedTimeframe(
  direction: "bullish" | "bearish" | null,
  frames: { label: string; tf: TimeframeAnalysis }[]
): string | null {
  if (!direction) return null;
  let best: { label: string; score: number } | null = null;
  for (const { label, tf } of frames) {
    let score = 0;
    if (tf.structure?.lastBOS?.direction === (direction === "bullish" ? "bullish" : "bearish")) score += 2;
    if (tf.regime && TRENDING_REGIMES.has(tf.regime.regime)) score += 1;
    if (tf.structure?.bias === direction) score += 1;
    if (!best || score > best.score) best = { label, score };
  }
  return best && best.score > 0 ? best.label : null;
}

function qualityFromScore(score: number): TradeQuality {
  if (score >= 85) return "A+";
  if (score >= 70) return "A";
  if (score >= 55) return "B";
  if (score >= 40) return "C";
  return "NO_TRADE";
}

export function buildDecision(input: DecisionInput): GoldDecisionOutput {
  const dataIssues = [...input.dataIssues];
  const now = Date.now(); // server compute time — used for `asOf` only, always the real wall clock even inside a backtest simulation
  const newsAssessment = input.newsRisk ?? NO_NEWS_DATA;
  const nextNewsEvent = newsAssessment.nextEvent
    ? { name: newsAssessment.nextEvent.name, source: newsAssessment.nextEvent.source, time: newsAssessment.nextEvent.time, minutesUntil: newsAssessment.minutesUntil ?? 0 }
    : null;

  // Two-pass config selection per timeframe: the regime isn't known until
  // it's classified, but a regime-aware config lookup needs the regime —
  // so pass 1 bootstraps a regime read with the generic (regime="ANY")
  // expert baseline, then pass 2 re-selects and re-classifies using
  // whichever regime bucket that bootstrap read landed on. Today every
  // bucket's params are identical within a timeframe tier (see
  // configEngine's SHARED indicator numbers), so this doesn't change the
  // numbers yet — but it's real wiring, not decoration: the moment a
  // regime-specific profile is genuinely validated with different
  // numbers, this path starts using them with no further change here.
  const configRegistry = input.configRegistry ?? CONFIG_REGISTRY;
  const configTrace: ConfigTraceEntry[] = [];
  const analyzeTimeframe = (candles: Candle[] | null, timeframe: string): TimeframeAnalysis => {
    if (!candles) return { regime: null, structure: null, rsiPeriod: null };

    const bootstrap = selectConfig(timeframe, "ANY", configRegistry);
    const bootstrapRegime = classifyRegime(candles, bootstrap.config.params);
    const bucket = regimeToBucket(bootstrapRegime?.regime);

    const { config, trace } = selectConfig(timeframe, bucket, configRegistry);
    configTrace.push({ timeframe, configId: config.id, strategyLabel: config.strategyLabel, status: config.status, confidence: config.confidence, params: config.params, selectionSteps: trace });

    return { regime: classifyRegime(candles, config.params), structure: analyzeStructure(candles, config.params), rsiPeriod: config.params.rsiPeriod };
  };

  const tf4h = analyzeTimeframe(input.candles4h, "4H");
  const tf1h = analyzeTimeframe(input.candles1h, "1H");
  const tf30m = analyzeTimeframe(input.candles30m, "30M");
  const tf15m = analyzeTimeframe(input.candles15m, "15M");
  const tf5m = analyzeTimeframe(input.candles5m, "5M");

  const primaryTimeframe = input.primaryTimeframe ?? "15M";
  const framesByLabel: Record<string, TimeframeAnalysis> = { "4H": tf4h, "1H": tf1h, "30M": tf30m, "15M": tf15m, "5M": tf5m };
  const tfPrimary = framesByLabel[primaryTimeframe] ?? tf15m;
  const primaryCandlesByTf: Record<string, Candle[] | null> = {
    "4H": input.candles4h,
    "1H": input.candles1h,
    "30M": input.candles30m,
    "15M": input.candles15m,
    "5M": input.candles5m,
  };

  // The reference "current" market moment for time-of-day-dependent
  // checks (sessions, the gold-fix window below) — deliberately NOT the
  // same as `now`/asOf above. For a live decision the most recent 5M
  // candle is at most a few minutes behind real time anyway; inside the
  // backtest engine's simulation it's the actual historical instant
  // being evaluated. Using Date.now() here would make every simulated
  // backtest trade see whatever session/gold-fix state happens to be
  // true right now in reality — completely unrelated to the historical
  // moment each trade is supposed to represent.
  const marketNow = input.candles5m && input.candles5m.length > 0 ? input.candles5m[input.candles5m.length - 1].time : now;

  const price = input.price;
  const liquidity: LiquidityReport | null =
    input.dailyCandles && input.candles15m && price != null ? analyzeLiquidity(input.dailyCandles, input.candles15m, price) : null;
  const sessions = input.candles5m ? analyzeSessions(input.candles5m, marketNow) : [];

  const criticalStaleness = input.criticalStaleness ?? [];
  const dataHealth: GoldDecisionOutput["dataHealth"] =
    price == null || !tfPrimary.regime ? "failed" : criticalStaleness.length > 0 ? "failed" : dataIssues.length > 0 ? "degraded" : "healthy";

  const why: string[] = [];
  const whyWait: string[] = [];

  if (dataHealth === "failed") {
    return {
      symbol: "XAU/USD",
      price,
      priceAsOf: input.priceAsOf ?? null,
      asOf: now,
      dataHealth,
      dataIssues,
      regime: tfPrimary.regime,
      structure: tfPrimary.structure,
      liquidity,
      decision: "wait",
      quality: "NO_TRADE",
      signalScore: 0,
      historicalProbability: null,
      configStatus: "BASELINE_NOT_VALIDATED",
      entryZone: null,
      entryTimeWindow: null,
      exitPlan: [],
      primaryTimeframe,
      stopLoss: null,
      tp1: null,
      tp2: null,
      tp3: null,
      riskRewardTp1: null,
      expectedDuration: null,
      newsRisk: newsAssessment.level,
      nextNewsEvent,
      newsBlackoutReason: newsAssessment.blackoutReason,
      sessions,
      recommendedTimeframe: null,
      configTrace,
      directionEstimate: { direction: "neutral", confidencePct: 0, bullVotes: 0, bearVotes: 0, totalFrames: 0, basis: "بيانات غير كافية لتقدير الاتجاه." },
      entryQuality: null,
      slQuality: null,
      why: [],
      whyWait: ["بيانات السوق غير كافية أو غير موثوقة حالياً — لا يمكن اتخاذ قرار.", ...criticalStaleness, ...dataIssues],
      alternativeScenario: null,
      disclaimer:
        "هذا التحليل آلي لأغراض معلوماتية فقط وليس نصيحة استثمارية. النظام في مرحلة أساسية (Baseline) ولم يخضع بعد لاختبار تاريخي (backtesting) أو تحقق إحصائي.",
    };
  }

  const htfBias = biasOf(tf4h.regime, tf4h.structure);
  const midBias = biasOf(tf1h.regime, tf1h.structure);
  const structureBias = biasOf(tf30m.regime, tf30m.structure);
  const primaryBias = biasOf(tf15m.regime, tf15m.structure);
  const entryBias = biasOf(tf5m.regime, tf5m.structure);

  const biases = [htfBias, midBias, structureBias, primaryBias, entryBias];
  const bullVotes = biases.filter((b) => b === "bullish").length;
  const bearVotes = biases.filter((b) => b === "bearish").length;

  // Which timeframes actually get to vote on the ACTIONABLE `direction`
  // scales with the selected primaryTimeframe. A scalp held 15-30 minutes
  // has no real use for 4H (spans days) — requiring it to agree meant a
  // fast-timeframe scalp could go a full day without ever seeing a signal,
  // even during a real, fast, sustained move (see priceMomentum above: the
  // higher frames were often still lagging, not actually disagreeing).
  // 30M/1H/4H stay on the full 5-frame requirement — those ARE
  // swing/position horizons where broader agreement is the entire point.
  // directionEstimate below is deliberately UNAFFECTED by this: it's the
  // informational "what does the whole picture look like" read, not the
  // tradeable one, so it always weighs all 5 regardless of primaryTimeframe.
  const SCALP_TIMEFRAMES = new Set(["5M", "15M"]);
  const isScalpWindow = SCALP_TIMEFRAMES.has(primaryTimeframe);
  const windowBiases = isScalpWindow ? [structureBias, primaryBias, entryBias] : biases; // 30M/15M/5M vs. the full 4H..5M set
  const windowBull = windowBiases.filter((b) => b === "bullish").length;
  const windowBear = windowBiases.filter((b) => b === "bearish").length;
  const requiredVotes = Math.floor(windowBiases.length / 2) + 1; // strict majority — 3-of-5 before, 2-of-3 for the scalp window

  let direction: "bullish" | "bearish" | null = null;
  if (windowBull >= requiredVotes && windowBull > windowBear) direction = "bullish";
  else if (windowBear >= requiredVotes && windowBear > windowBull) direction = "bearish";

  if (isScalpWindow) {
    why.push(`فريم ${primaryTimeframe} فريم مضاربة سريعة — شرط التوافق اقتصر على 30M/15M/5M فقط (بدون 4H/1H غير ذات الصلة بصفقة مدتها دقائق).`);
  }

  // A raw lean is tracked separately from `direction` (which requires a
  // strict majority to be actionable) — the market can be estimated as
  // leaning bullish/bearish even when that lean isn't strong enough to
  // trade, and the two must never be presented as the same thing.
  const rawLean: "bullish" | "bearish" | "neutral" = bullVotes > bearVotes ? "bullish" : bearVotes > bullVotes ? "bearish" : "neutral";
  const leanVotes = Math.max(bullVotes, bearVotes);
  const directionEstimate = {
    direction: rawLean,
    confidencePct: Math.round((leanVotes / biases.length) * 100),
    bullVotes,
    bearVotes,
    totalFrames: biases.length,
    basis:
      leanVotes >= 3
        ? "تقدير توافقي بين الفريمات الخمسة (Confluence) — تقدير فني، وليس احتمالاً معايَراً إحصائياً. النسبة هون مش احتمال بمعنى إحصائي، وما إلها نقيض — يعني هابط 40% ما بيعني صاعد 60%؛ الباقي ممكن يكون محايد أو متضارب."
        : "توافق ضعيف بين الفريمات — تقدير منخفض الثقة إحصائياً. النسبة هون مش احتمال بمعنى إحصائي، وما إلها نقيض — يعني هابط 40% ما بيعني صاعد 60%؛ الباقي ممكن يكون محايد أو متضارب.",
  };

  const recommendedTimeframe = pickRecommendedTimeframe(direction, [
    { label: "30M", tf: tf30m },
    { label: "15M", tf: tf15m },
    { label: "5M", tf: tf5m },
  ]);

  why.push(`4H: ${htfBias === "bullish" ? "صاعد" : htfBias === "bearish" ? "هابط" : "محايد"}, 1H: ${midBias === "bullish" ? "صاعد" : midBias === "bearish" ? "هابط" : "محايد"}, 30M: ${structureBias === "bullish" ? "صاعد" : structureBias === "bearish" ? "هابط" : "محايد"}, 15M: ${primaryBias === "bullish" ? "صاعد" : primaryBias === "bearish" ? "هابط" : "محايد"}, 5M: ${entryBias === "bullish" ? "صاعد" : entryBias === "bearish" ? "هابط" : "محايد"}.`);

  if (tfPrimary.regime) why.push(...tfPrimary.regime.reasoning);
  if (tfPrimary.structure) why.push(...tfPrimary.structure.reasoning);

  if (input.macro.us10yTrend) {
    why.push(`عائد سندات 10 سنوات: ${input.macro.us10yTrend === "up" ? "مرتفع" : input.macro.us10yTrend === "down" ? "منخفض" : "مستقر"} (سياق فقط — لا يُستخدم لتغيير النتيجة النهائية).`);
  }
  if (input.macro.dxyTrend) {
    why.push(`الدولار (عبر EUR/USD كـ proxy): ${input.macro.dxyTrend === "up" ? "يتقوى" : input.macro.dxyTrend === "down" ? "يضعف" : "مستقر"} (سياق فقط — العلاقة مع الذهب غير ثابتة دائماً).`);
  }
  const activeSessions = sessions.filter((s) => s.active).map((s) => s.label);
  if (activeSessions.length > 0) {
    why.push(`الجلسات النشطة الآن: ${activeSessions.join(" + ")}.`);
  }

  let signalScore = 40;
  signalScore += bullVotes >= bearVotes ? bullVotes * 6 : bearVotes * 6;
  if (tfPrimary.structure?.lastBOS) signalScore += 10;
  if (tf5m.structure?.lastBOS?.direction === (direction === "bullish" ? "bullish" : "bearish")) signalScore += 8;

  // RSI/MACD/volume — real computed values (lib/gold/indicators.ts), used
  // as modest supporting confirmation, never as the sole reason to enter
  // or block a trade (structure/liquidity/multi-timeframe confluence
  // still drive the actual decision — an oscillator agreeing just adds a
  // little weight, disagreeing subtracts a little and gets flagged as a
  // caution, same as the rest of this engine's evidence-weighting).
  const rsi = tfPrimary.regime?.rsi ?? null;
  const macd = tfPrimary.regime?.macd ?? null;
  if (direction && macd) {
    const macdBullish = macd.histogram > 0;
    const macdAgrees = (direction === "bullish" && macdBullish) || (direction === "bearish" && !macdBullish);
    if (macdAgrees) {
      signalScore += 5;
      why.push(
        `MACD على فريم ${primaryTimeframe} يؤكد الزخم ${direction === "bullish" ? "الصاعد" : "الهابط"} — الهيستوغرام ${macdBullish ? "إيجابي" : "سلبي"} و${macd.histogramRising ? "في تزايد" : "شبه مستقر"}.`
      );
    } else {
      signalScore -= 5;
      why.push(
        `تنبيه: MACD على فريم ${primaryTimeframe} لسا ما أكد الزخم ${direction === "bullish" ? "الصاعد" : "الهابط"} — الهيستوغرام ${macdBullish ? "إيجابي" : "سلبي"} (عكس الاتجاه المتوقع). دليل إضافي للحذر، وليس سبباً وحيداً للانتظار.`
      );
    }
  }
  if (direction && rsi != null) {
    if (direction === "bullish" && rsi >= 75) {
      signalScore -= 5;
      why.push(`تنبيه: RSI (${rsi.toFixed(0)}) على فريم ${primaryTimeframe} بمنطقة تشبع شرائي — احتمال ارتداد أو توقف مؤقت قبل الاستمرار.`);
    } else if (direction === "bearish" && rsi <= 25) {
      signalScore -= 5;
      why.push(`تنبيه: RSI (${rsi.toFixed(0)}) على فريم ${primaryTimeframe} بمنطقة تشبع بيعي — احتمال ارتداد أو توقف مؤقت قبل الاستمرار.`);
    } else {
      why.push(`RSI على فريم ${primaryTimeframe}: ${rsi.toFixed(0)} — خارج مناطق التشبع، ${rsi >= 50 ? "لصالح الزخم الصاعد" : "لصالح الزخم الهابط"} نسبياً.`);
    }
  }

  // RSI divergence — momentum quietly weakening even though price keeps
  // pushing the same direction the fired signal wants. Only meaningful
  // when it opposes the fired direction (agreement is nothing new beyond
  // what RSI's level already said above); when it does oppose, it's
  // real evidence to be cautious, not decisive on its own.
  const primaryCandlesForDivergence = primaryCandlesByTf[primaryTimeframe];
  if (direction && tfPrimary.rsiPeriod != null && primaryCandlesForDivergence) {
    const divergence = detectRsiDivergence(primaryCandlesForDivergence, tfPrimary.rsiPeriod);
    if ((direction === "bullish" && divergence.type === "bearish") || (direction === "bearish" && divergence.type === "bullish")) {
      signalScore -= 8;
      why.push(`تنبيه: ${divergence.note} هذا يعاكس اتجاه الإشارة الحالية — دليل حذر إضافي، وليس سبباً وحيداً للانتظار.`);
    }
  }

  const volumeInfo = tfPrimary.regime?.volume;
  if (volumeInfo?.available && volumeInfo.relativeToAvg != null) {
    why.push(
      volumeInfo.relativeToAvg >= 1.3
        ? `الفوليوم الحالي على فريم ${primaryTimeframe} أعلى من المتوسط بـ${volumeInfo.relativeToAvg}× — يدعم مصداقية الحركة الحالية.`
        : volumeInfo.relativeToAvg <= 0.6
        ? `الفوليوم الحالي على فريم ${primaryTimeframe} أقل من المتوسط (${volumeInfo.relativeToAvg}×) — الحركة الحالية أقل دعماً من المعتاد.`
        : `الفوليوم على فريم ${primaryTimeframe} ضمن المعدل الطبيعي (${volumeInfo.relativeToAvg}× المتوسط).`
    );
  } else {
    why.push("بيانات الفوليوم غير متوفرة أو غير موثوقة لهذا الرمز حالياً (شائع بالفوركس/المعادن الفورية — لا توجد بورصة مركزية واحدة تجمعه) — لم تُستخدم بالتحليل.");
  }

  const extremeVol = tfPrimary.regime?.regime === "extreme_volatility";
  const compressed = tfPrimary.regime?.regime === "compression";
  if (extremeVol) {
    signalScore -= 25;
    whyWait.push(`تقلب شديد (Extreme Volatility) على الفريم الأساسي ${primaryTimeframe} — المخاطرة على وقف الخسارة غير موثوقة الآن.`);
  }
  if (compressed) {
    whyWait.push("السعر في تجميع/انضغاط (Compression) — ينتظر النظام كسراً واضحاً قبل تحديد الاتجاه.");
  }
  if (dataIssues.length > 0) {
    signalScore -= 10;
    // Individual dataIssues entries are inconsistent about a trailing
    // period (some end a full sentence, some don't) — strip it before
    // joining so this never renders a stray double period ("..").
    whyWait.push(`بيانات جزئية غير متوفرة: ${dataIssues.map((issue) => issue.replace(/\.$/, "")).join("، ")}.`);
  }

  signalScore = Math.max(0, Math.min(100, Math.round(signalScore)));
  const quality = qualityFromScore(signalScore);

  let decision: Decision = "wait";
  if (direction && quality !== "NO_TRADE" && quality !== "C" && !extremeVol && !compressed) {
    decision = direction === "bullish" ? "buy" : "sell";
  } else {
    if (!direction) {
      whyWait.push(
        isScalpWindow
          ? "لا يوجد توافق كافٍ (confluence) بين فريمات المضاربة السريعة (30M/15M/5M) — الإشارات متضاربة أو غير حاسمة."
          : "لا يوجد توافق كافٍ (confluence) بين الفريمات — الإشارات متضاربة أو غير حاسمة."
      );
      // "No confluence" on its own can read as "the system can't tell,"
      // when the real reason is often that ADX/structure are lagging
      // indicators that haven't caught up to a fast move yet (see
      // priceMomentum's comment). Surfacing the raw price displacement
      // here answers "why does this look wrong" honestly instead of
      // leaving a plain no-confluence message as the last word.
      const momentum = priceMomentum(primaryCandlesByTf[primaryTimeframe] ?? null, tfPrimary.regime?.atr ?? null);
      if (momentum && momentum.direction !== "neutral") {
        whyWait.push(
          `تنبيه: السعر تحرك ${momentum.pctMove > 0 ? "+" : ""}${momentum.pctMove}% خلال آخر 10 شمعات على فريم ${primaryTimeframe} — حركة سريعة، ومؤشرات الاتجاه المتأخرة (ADX والهيكل السعري) لسا ما انعكست عليها بالكامل، هيك السبب يلي بيخلي "لا توافق" رغم وضوح الحركة بالسعر.`
        );
      }
    }
    if (quality === "C" || quality === "NO_TRADE") whyWait.push(`جودة الإعداد الحالية ضعيفة (${quality}) — لا تستوفي حد الدخول.`);
  }

  // News blackout overrides everything else — a technically clean setup is
  // still a NO TRADE inside the window around a high-impact release.
  if (newsAssessment.inBlackout) {
    decision = "wait";
    whyWait.unshift(newsAssessment.blackoutReason ?? "خبر اقتصادي عالي الأهمية ضمن نافذة الحظر الآن — لا دخول.");
  } else if (newsAssessment.level === "medium" && newsAssessment.nextEvent) {
    why.push(`تنبيه: ${newsAssessment.nextEvent.name} خلال ${newsAssessment.minutesUntil} دقيقة — راقب نافذة الحظر حين تقترب.`);
  }

  const atrPrimary = tfPrimary.regime?.atr ?? 0;
  // The pullback anchor (EMA-medium, e.g. EMA21) is a real structural
  // level independent of the current price — unlike anchoring the zone to
  // "current price minus a bit," this lets entry quality actually mean
  // something: price can be technically bullish while sitting far above
  // this anchor, which is exactly the "right direction, bad entry" case.
  const emaMediumPrimary = tfPrimary.regime?.emaMedium ?? null;
  const structLevelPrimary =
    tfPrimary.structure?.swings && tfPrimary.structure.swings.length > 0
      ? [...tfPrimary.structure.swings].reverse().find((s) => s.kind === (direction === "bullish" ? "low" : "high"))
      : null;

  let entryZone: [number, number] | null = null;
  let stopLoss: number | null = null;
  let tp1: number | null = null;
  let tp2: number | null = null;
  let tp3: number | null = null;
  let entryQuality: "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | null = null;
  let slQuality: "TIGHT" | "NORMAL" | "WIDE" | "EXTREME" | null = null;

  if (price != null && direction != null && atrPrimary > 0) {
    const anchor = emaMediumPrimary ?? price;
    const zoneLow = Number((anchor - atrPrimary * 0.3).toFixed(2));
    const zoneHigh = Number((anchor + atrPrimary * 0.3).toFixed(2));
    entryZone = [Math.min(zoneLow, zoneHigh), Math.max(zoneLow, zoneHigh)];

    if (direction === "bullish") {
      let structStop = structLevelPrimary ? structLevelPrimary.price - atrPrimary * 0.3 : anchor - atrPrimary * 1.2;
      // A "confirmed" swing low needs several bars of follow-through to be
      // recognized, so the most recent one on record can be several
      // candles old. If price has since dropped further, that stale swing
      // can sit ABOVE current price — a "stop-loss" above entry on a buy,
      // which is nonsensical and not just risky. Never trust it blindly;
      // fall back to a price-anchored stop when it lands on the wrong side.
      if (structStop >= price) {
        structStop = price - atrPrimary * 1.5;
        why.push("وقف الخسارة الهيكلي (آخر قاع مؤكد) لم يعد صالحاً لأن السعر تجاوزه — تم استخدام وقف بديل مبني على ATR بدل الاعتماد على مستوى قديم.");
      }
      stopLoss = Number(structStop.toFixed(2));
      tp1 = Number((liquidity?.nearestAbove?.price ?? price + atrPrimary * 1.5).toFixed(2));
      tp2 = Number((price + atrPrimary * 3).toFixed(2));
      tp3 = Number((price + atrPrimary * 4.5).toFixed(2));

      const extensionInAtr = (price - anchor) / atrPrimary; // positive = price has run up away from the pullback anchor
      entryQuality = extensionInAtr <= 0.3 ? "EXCELLENT" : extensionInAtr <= 1.0 ? "GOOD" : extensionInAtr <= 2.0 ? "FAIR" : "POOR";
    } else {
      let structStop = structLevelPrimary ? structLevelPrimary.price + atrPrimary * 0.3 : anchor + atrPrimary * 1.2;
      // Mirror of the bullish guard above: a stale confirmed swing high can
      // sit BELOW current price if price has since risen past it, which
      // would put a sell's stop-loss below its entry instead of above it.
      if (structStop <= price) {
        structStop = price + atrPrimary * 1.5;
        why.push("وقف الخسارة الهيكلي (آخر قمة مؤكدة) لم يعد صالحاً لأن السعر تجاوزه — تم استخدام وقف بديل مبني على ATR بدل الاعتماد على مستوى قديم.");
      }
      stopLoss = Number(structStop.toFixed(2));
      tp1 = Number((liquidity?.nearestBelow?.price ?? price - atrPrimary * 1.5).toFixed(2));
      tp2 = Number((price - atrPrimary * 3).toFixed(2));
      tp3 = Number((price - atrPrimary * 4.5).toFixed(2));

      const extensionInAtr = (anchor - price) / atrPrimary;
      entryQuality = extensionInAtr <= 0.3 ? "EXCELLENT" : extensionInAtr <= 1.0 ? "GOOD" : extensionInAtr <= 2.0 ? "FAIR" : "POOR";
    }

    const slDistanceInAtr = Math.abs(price - stopLoss) / atrPrimary;
    slQuality = slDistanceInAtr < 0.8 ? "TIGHT" : slDistanceInAtr <= 2.0 ? "NORMAL" : slDistanceInAtr <= 3.5 ? "WIDE" : "EXTREME";
  }

  let riskRewardTp1: number | null = null;
  if (price != null && stopLoss != null && tp1 != null) {
    const risk = Math.abs(price - stopLoss);
    const reward = Math.abs(tp1 - price);
    riskRewardTp1 = risk > 0 ? Number((reward / risk).toFixed(2)) : null;
  }

  // Trade-quality gate: a technically correct direction is not, by
  // itself, a reason to enter right now. Direction says "which way";
  // this says "is taking the trade at this exact location justified."
  if (decision !== "wait" && entryQuality != null) {
    if (entryQuality === "POOR") {
      decision = "wait";
      whyWait.unshift(
        `الاتجاه (${direction === "bullish" ? "صاعد" : "هابط"}) لسا صحيح تقنياً، بس السعر الحالي مبتعد كثير عن منطقة الدخول المثالية (${entryZone![0].toFixed(2)}–${entryZone![1].toFixed(2)}) — دخول الآن يعني وقف خسارة أوسع وعائد أضعف.`
      );
    } else if (slQuality === "EXTREME") {
      decision = "wait";
      whyWait.unshift("وقف الخسارة المطلوب هيكلياً واسع جداً مقارنة بالتقلب الحالي (ATR) — المخاطرة غير مبرَّرة الآن حتى لو الاتجاه صحيح.");
    } else if (riskRewardTp1 != null && riskRewardTp1 < 1.0) {
      decision = "wait";
      whyWait.unshift(`نسبة المخاطرة:العائد للهدف الأول ضعيفة حالياً (1:${riskRewardTp1}) — غير مبرَّرة حتى لو الاتجاه صحيح.`);
    }
  }

  // Stale-price gate: checked last so it takes the top whyWait slot when
  // it fires — every other number above (direction, entry zone, SL, TP,
  // R:R) was computed from `price`, so if `price` itself can't be
  // trusted, none of those numbers can either, regardless of how clean
  // the setup otherwise looks. Normal free-tier lag is seconds to a
  // couple of minutes; this only trips on genuine staleness (a provider
  // outage, a stuck cache, a market-closed gap) — "never trade on stale
  // data" as an enforced rule, not just a disclosed footnote.
  const MAX_ACCEPTABLE_PRICE_AGE_MS = 20 * 60_000;
  const priceAgeMs = input.priceAsOf != null ? now - input.priceAsOf : null;
  if (decision !== "wait" && priceAgeMs != null && priceAgeMs > MAX_ACCEPTABLE_PRICE_AGE_MS) {
    decision = "wait";
    const ageLabel = priceAgeMs >= 3_600_000 ? `${(priceAgeMs / 3_600_000).toFixed(1)} ساعة` : `${Math.round(priceAgeMs / 60_000)} دقيقة`;
    whyWait.unshift(
      `السعر المستخدم أقدم من ${ageLabel} — بيانات قديمة جداً لاتخاذ قرار دخول موثوق الآن، بغض النظر عن باقي الإشارات. تحقق من اتصال المزوّدين أو انتظر تحديث بيانات حديث.`
    );
  }

  // LBMA gold-fix gate: checked after the stale-price gate so it takes
  // priority right below it — a real, twice-daily, gold-specific
  // volatility-spike window (large physical/OTC positions get priced
  // against the fix auction), well documented in gold-trading references
  // as a source of exactly the kind of whipsaw this project has been
  // trying to filter out. Deterministic and clock-only (see goldFix.ts),
  // narrow (±10 min) on purpose — wide enough to matter, narrow enough
  // not to meaningfully cut into a full session's trading opportunity.
  const goldFix = nearGoldFixWindow(marketNow);
  if (decision !== "wait" && goldFix.active) {
    decision = "wait";
    whyWait.unshift(`ضمن نافذة ${goldFix.label} — تقلب سعري معروف حول وقت التثبيت، يفضَّل الانتظار حتى تهدأ الحركة قبل الدخول.`);
  }

  // Condition-based, not clock-based — never claim to know exactly when
  // price will do something in the future (per the explicit "never
  // fabricate exact future times" rule). "Enter now" is only ever said
  // when price is already at/near the anchor; otherwise this names the
  // condition to wait for, not a guessed number of minutes.
  let entryTimeWindow: string | null = null;
  const directionWord = direction === "bullish" ? "شراء" : direction === "bearish" ? "بيع" : null;
  if (decision !== "wait") {
    entryTimeWindow =
      entryQuality === "EXCELLENT"
        ? `ادخل ${directionWord} الآن — السعر ضمن منطقة الدخول المثالية على فريم ${primaryTimeframe}.`
        : `يمكن الدخول ${directionWord} الآن، أو عند إغلاق شمعة ${primaryTimeframe} القادمة لتأكيد إضافي.`;
  } else if (entryZone != null && directionWord != null) {
    // One merged sentence: state the exact blocking reason, the price
    // condition to wait for, AND the direction to take once it's met —
    // never split these across separate places the reader has to piece
    // together herself.
    const primaryReason = whyWait[0] ?? "الشروط الحالية غير مكتملة للدخول";
    entryTimeWindow = `لا تدخل الآن على فريم ${primaryTimeframe} — ${primaryReason} استنى وصول السعر لمنطقة (${entryZone[0].toFixed(2)}–${entryZone[1].toFixed(2)})، وبس توصلها ادخل ${directionWord}، لأن الاتجاه العام حالياً ${direction === "bullish" ? "صاعد" : "هابط"}.`;
  } else if (!direction) {
    // No 3-vote confluence means there's no confirmed direction to anchor
    // an entry zone to — entryZone/directionWord stay null on purpose (see
    // the price!=null && direction!=null gate above), so this box would
    // otherwise say nothing at all about what to do next. It still can't
    // honestly promise a price zone or an exact direction, but it CAN
    // honestly report the raw lean (rawLean/directionEstimate, which needs
    // no vote threshold) so the reader isn't left with silence.
    const primaryReason = whyWait[0] ?? "التوافق بين الفريمات ضعيف حالياً";
    entryTimeWindow =
      rawLean !== "neutral"
        ? `لا يوجد اتجاه مؤكد كفاية للدخول على فريم ${primaryTimeframe} — ${primaryReason} في ميل أولي ${rawLean === "bullish" ? "صاعد" : "هابط"} (${leanVotes} من ${biases.length} فريمات)، بس مش قوي كفاية للدخول عليه. انتظر فريم إضافي يتفق بنفس الاتجاه قبل التفكير بالدخول.`
        : `لا يوجد اتجاه واضح حالياً على فريم ${primaryTimeframe} — ${primaryReason} الإشارات متوازنة بين الفريمات الخمسة، لا يوجد حتى ميل أولي راجح لأي جهة. انتظر وضوح أكبر قبل أي قرار.`;
  }

  const exitPlan: string[] =
    decision !== "wait" && stopLoss != null && tp1 != null
      ? [
          `خذ جزء من الربح (مثلاً نص الكمية) عند TP1 (${tp1.toFixed(2)}) وحرّك وقف الخسارة لنقطة الدخول (تعادل) — هيك حتى لو ارتد السعر بعدها ما تخسر.`,
          `استمر بالباقي نحو TP2 (${tp2?.toFixed(2) ?? "—"}) أو TP3 (${tp3?.toFixed(2) ?? "—"}) حسب استمرار الزخم — لا داعي للعجلة بالإغلاق الكامل إذا الهيكل لسا يدعم الاتجاه.`,
          `أغلق الصفقة بالكامل فوراً لو رجع السعر ولمس وقف الخسارة (${stopLoss.toFixed(2)}) — هذا إبطال لفكرة الصفقة نفسها، مش وقت "تصبر وتنتظر".`,
        ]
      : [];

  const alternativeDirection = direction === "bullish" ? "sell" : direction === "bearish" ? "buy" : null;
  const alternativeScenario =
    alternativeDirection && price != null && atrPrimary > 0
      ? {
          direction: alternativeDirection as "buy" | "sell",
          conditions:
            alternativeDirection === "buy"
              ? ["كسر هيكلي صاعد (BOS) مؤكد على 15M/5M", "سيولة سفلية تُكتسح ثم ارتداد", "توافق 1H/4H مع الاتجاه الصاعد"]
              : ["كسر هيكلي هابط (BOS) مؤكد على 15M/5M", "سيولة علوية تُكتسح ثم ارتداد", "توافق 1H/4H مع الاتجاه الهابط"],
          entryZone: null,
          stopLoss: null,
          tp1: null,
          tp2: null,
          tp3: null,
          entryTimeWindow: "عند تحقق الشروط أعلاه فقط",
        }
      : null;

  return {
    symbol: "XAU/USD",
    price,
    priceAsOf: input.priceAsOf ?? null,
    asOf: now,
    dataHealth,
    dataIssues,
    regime: tfPrimary.regime,
    structure: tfPrimary.structure,
    liquidity,
    decision,
    quality,
    signalScore,
    historicalProbability: null,
    configStatus: "BASELINE_NOT_VALIDATED",
    entryZone,
    entryTimeWindow,
    exitPlan,
    primaryTimeframe,
    stopLoss,
    tp1,
    tp2,
    tp3,
    riskRewardTp1,
    expectedDuration: null,
    newsRisk: newsAssessment.level,
    nextNewsEvent,
    newsBlackoutReason: newsAssessment.blackoutReason,
    sessions,
    recommendedTimeframe,
    configTrace,
    directionEstimate,
    entryQuality,
    slQuality,
    why,
    whyWait,
    alternativeScenario,
    disclaimer:
      "هذا التحليل آلي لأغراض معلوماتية/تعليمية فقط وليس نصيحة استثمارية أو توصية مالية مرخّصة. النظام في مرحلة أساسية (Baseline) قائم على قواعد محددة صراحة، وتحقق إحصائي أولي (Backtest داخل نفس العيّنة فقط) — راجع لوحة الاختبار التاريخي. تقويم الأخبار يغطي حالياً فقط قرارات الفيدرالي (FOMC) ومؤشر أسعار المستهلك (CPI) والوظائف (NFP) من مصادر رسمية مباشرة — أخبار جيوسياسية أو أحداث أخرى غير مغطاة، لذا يبقى التحقق اليدوي من الأخبار قبل أي قرار مسؤوليتك. التداول في الذهب ينطوي على مخاطر خسارة حقيقية لرأس المال.",
  };
}
