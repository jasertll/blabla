import type { ProviderState } from "@/lib/osintTypes";

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number | null };

export type Timeframe = "5min" | "15min" | "30min" | "1h" | "4h" | "1day";

export type MarketRegime =
  | "strong_bull_trend"
  | "weak_bull_trend"
  | "strong_bear_trend"
  | "weak_bear_trend"
  | "range"
  | "compression"
  | "breakout"
  | "high_volatility"
  | "extreme_volatility"
  | "unclear";

export type RegimeReport = {
  regime: MarketRegime;
  atr: number;
  atrPercentile: number; // 0-100, position of current ATR within recent history
  adx: number;
  emaFast: number;
  emaMedium: number;
  emaSlow: number;
  // Real, computed values (see lib/gold/indicators.ts) — supporting
  // evidence for entry confirmation, not regime classification itself
  // (regime stays ATR/ADX/EMA-structure based, per the existing "no
  // single indicator decides regime alone" design). Null only when the
  // candle history is too short to compute them.
  rsi: number | null;
  macd: { line: number; signalLine: number; histogram: number; histogramRising: boolean } | null;
  volume: { available: boolean; relativeToAvg: number | null };
  reasoning: string[];
};

export type SwingPoint = { time: number; price: number; kind: "high" | "low" };

export type StructureReport = {
  swings: SwingPoint[];
  sequence: ("HH" | "HL" | "LH" | "LL")[];
  lastBOS: { direction: "bullish" | "bearish"; time: number; level: number } | null;
  bias: "bullish" | "bearish" | "neutral";
  reasoning: string[];
};

export type LiquidityLevel = { label: string; price: number; kind: "high" | "low" };

export type LiquidityReport = {
  levels: LiquidityLevel[];
  nearestAbove: LiquidityLevel | null;
  nearestBelow: LiquidityLevel | null;
};

export type Decision = "buy" | "sell" | "wait";

export type TradeQuality = "A+" | "A" | "B" | "C" | "NO_TRADE";

export type NewsRiskLevel = "low" | "medium" | "high" | "extreme" | "unavailable";

export type DataHealth = "healthy" | "degraded" | "failed";

export type ScenarioPlan = {
  direction: "buy" | "sell";
  conditions: string[];
  entryZone: [number, number] | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  entryTimeWindow: string | null;
};

export type GoldDecisionOutput = {
  symbol: "XAU/USD";
  price: number | null;
  // The provider's own timestamp for `price` (when the quote/candle was
  // actually last observed), separate from `asOf` (when this server
  // computed the decision). A free-tier data feed can lag real-time by
  // more than a moment — this is what lets the UI disclose that lag
  // honestly instead of implying `price` is live just because `asOf` is.
  priceAsOf: number | null;
  asOf: number;
  dataHealth: DataHealth;
  dataIssues: string[];

  regime: RegimeReport | null;
  structure: StructureReport | null;
  liquidity: LiquidityReport | null;

  decision: Decision;
  quality: TradeQuality;
  signalScore: number; // 0-100, deterministic rule-based score — NOT a calibrated probability
  historicalProbability: null; // Phase 1 has no backtest history yet — always null, never fabricated
  configStatus: "BASELINE_NOT_VALIDATED";

  entryZone: [number, number] | null;
  entryTimeWindow: string | null;
  exitPlan: string[];
  primaryTimeframe: string;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  riskRewardTp1: number | null;
  expectedDuration: string | null;

  newsRisk: NewsRiskLevel;
  nextNewsEvent: { name: string; source: string; time: number; minutesUntil: number } | null;
  newsBlackoutReason: string | null;

  sessions: { session: string; label: string; active: boolean; open: number | null; high: number | null; low: number | null }[];
  recommendedTimeframe: string | null;

  // Deliberately separate from `decision` — direction can be estimated as
  // bullish/bearish while the trade itself is still WAIT because the
  // entry location, stop distance, or R:R don't justify acting on it yet.
  // bullVotes/bearVotes/totalFrames are the real counts confidencePct is
  // computed from (leanVotes/totalFrames) — exposed explicitly because
  // the percentage alone reads like a calibrated probability with a
  // complement ("40% bearish" implying "60% bullish"), which it is not:
  // the remaining frames can be neutral or mixed, not simply the other
  // direction. The UI shows the vote fraction as the primary number for
  // exactly this reason.
  directionEstimate: {
    direction: "bullish" | "bearish" | "neutral";
    confidencePct: number;
    bullVotes: number;
    bearVotes: number;
    totalFrames: number;
    basis: string;
  };
  entryQuality: "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | null;
  slQuality: "TIGHT" | "NORMAL" | "WIDE" | "EXTREME" | null;

  // Canonical freshness/source read for the price this decision used —
  // computed once in the API route (not inside buildDecision, which has
  // no concept of "which provider/how long ago" beyond priceAsOf) and
  // merged onto the response. Optional because the backtest engine's
  // internal buildDecision() calls never populate it.
  marketState?: {
    source: string | null;
    ageMs: number | null;
    latencyMs: number | null;
    feedStatus: "LIVE" | "DELAYED" | "STALE" | "CONFLICTED" | "UNAVAILABLE";
  };

  configTrace: {
    timeframe: string;
    configId: string;
    strategyLabel: string;
    status: string;
    confidence: string;
    params: Record<string, number>;
    selectionSteps: string[];
  }[];

  why: string[];
  whyWait: string[];

  alternativeScenario: ScenarioPlan | null;

  disclaimer: string;
};

export type CandleSet = Partial<Record<Timeframe, ProviderState<Candle[]>>>;
