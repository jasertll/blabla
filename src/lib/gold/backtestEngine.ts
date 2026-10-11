import type { Candle } from "@/lib/gold/types";
import { buildDecision } from "@/lib/gold/decision";
import { resampleCandles as resample } from "@/lib/gold/resample";
import { classifyHourSession } from "@/lib/gold/sessions";

export type BacktestTrade = {
  direction: "buy" | "sell";
  entryTime: number;
  entryPrice: number;
  effectiveEntryPrice: number;
  stopLoss: number;
  tp1: number;
  exitTime: number;
  exitPrice: number;
  effectiveExitPrice: number;
  outcome: "tp1" | "sl" | "timeout";
  rMultiple: number;
  regimeAtEntry: string | null;
  // Independent touch flags, not the trade's primary R-multiple outcome:
  // tp1Hit mirrors outcome==="tp1"; tp2Hit/tp3Hit ask "after securing TP1
  // (and moving the stop to breakeven, per the exit playbook), did price
  // also reach the further targets before the hold window ran out?"
  tp1Hit: boolean;
  tp2Hit: boolean;
  tp3Hit: boolean;
};

// Representative retail XAU/USD spread in price units at normal London/NY
// liquidity — not any specific broker's real number (that varies by
// broker), just a realistic middle-of-the-road baseline. Real spreads
// aren't flat through the day: they're tightest during the London/NY
// overlap (deepest liquidity) and widest during the post-NY/pre-Asian
// dead zone (thinnest liquidity) — SESSION_SPREAD_MULTIPLIER models that
// using each trade's own entry-time session, computed from the candle
// timestamps already in hand (see classifyHourSession in sessions.ts),
// no extra data fetch needed.
//
// What this deliberately does NOT model: spread widening around specific
// news releases. That would need point-in-time historical event
// timestamps (not just "the next upcoming event," which is all this app
// currently fetches) — faking it without real historical event data would
// be worse than leaving it out, so it's left out and disclosed in
// buildCaveats() below instead of silently assumed away.
const ASSUMED_SPREAD = 0.35;
const SESSION_SPREAD_MULTIPLIER: Record<ReturnType<typeof classifyHourSession>, number> = {
  overlap: 0.8,
  london: 1.0,
  new_york: 1.0,
  asian: 1.3,
  thin: 1.6,
};

function spreadForEntry(entryTime: number): number {
  return ASSUMED_SPREAD * SESSION_SPREAD_MULTIPLIER[classifyHourSession(entryTime)];
}

export type BacktestResult = {
  trades: BacktestTrade[];
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number | null;
  expectancyR: number;
  maxDrawdownR: number;
  avgWinDurationMinutes: number | null;
  avgLossDurationMinutes: number | null;
  tp1HitRatePct: number | null;
  tp2HitRatePct: number | null;
  tp3HitRatePct: number | null;
  periodStart: number | null;
  periodEnd: number | null;
  caveats: string[];
};

// Depth-dependent — a 6-page OANDA pull (~100+ calendar days) earns a very
// different honesty note than a single 5000-bar fallback fetch (~17-25
// days). Computed fresh from the actual candle series every run, never a
// static claim.
function buildCaveats(candles5m: Candle[]): string[] {
  const daySpan =
    candles5m.length > 1 ? Math.round((candles5m[candles5m.length - 1].time - candles5m[0].time) / (24 * 60 * 60_000)) : 0;
  const depthCaveat =
    daySpan >= 60
      ? `العيّنة تغطي ${daySpan} يوم تقويمي (${candles5m.length.toLocaleString("en-US")} شمعة 5M) — تجاوزت حد الـ60 يوم الأدنى الموصى به هنا، فتقييم كفاية الأدلة أدناه أقرب لدلالة حقيقية.`
      : `العيّنة تغطي ${daySpan} يوم تقويمي فقط (${candles5m.length.toLocaleString("en-US")} شمعة 5M) — أقل من حد الـ60 يوم الأدنى الموصى به، فأي نتيجة هنا أقرب لعيّنة أولية منها لدليل كافٍ. اضبط OANDA_API_TOKEN لجلب عمق تاريخي أكبر (صفحات متعددة بدل طلب واحد).`;
  return [
    "الفريمات الأعلى (15M/30M/1H/4H) محسوبة محلياً بتجميع شموع 5M — تقريب مقبول للاختبار، وليست بيانات مجلوبة منفصلة لكل فريم من المزوّد.",
    `السبريد المفترض ${ASSUMED_SPREAD.toFixed(2)}$ كخط أساس (نصفه دخول ونصفه خروج)، لكنه ليس ثابتاً — يتوسّع/يضيق حسب جلسة الدخول (أضيق بتقاطع لندن-نيويورك، أوسع بالفترة الهادئة بعد إغلاق نيويورك). ما زال تقديراً عاماً وليس سبريد الوسيط الفعلي عندك، ولا يشمل توسّع السبريد وقت الأخبار تحديداً (يحتاج توقيت تاريخي فعلي للأخبار، غير متوفر بعد) ولا نموذج عمولة منفصل.`,
    "هذا اختبار داخل نفس العيّنة (in-sample) فقط — الإعدادات (فترات المؤشرات) ثابتة (Expert Baseline) ولم تُحسّن إحصائياً على هذه البيانات، فمخاطر الإفراط بالمطابقة (overfitting) منخفضة، لكن لا يوجد بعد فصل رسمي تدريب/تحقق (walk-forward) كامل، ولا اختبار Monte Carlo لتوزيع السحب (drawdown). ما هو موجود فعلياً: فحص استقرار عبر نصفي العيّنة الزمنيين قبل ترقية أي إعداد (انظر لوحة تشخيص الإعدادات).",
    depthCaveat,
    "قرار كل صفقة هنا استُخدم فيه فقط البيانات المتوفرة حتى تلك اللحظة (بدون نظر للمستقبل) للسعر والمؤشرات الفنية — لكن الأخبار/الماكرو غير مُدخلة أصلاً بهذا الاختبار (لا نافذة حظر أخبار، لا اتجاه عوائد/دولار)، فهذا اختبار للمنطق الفني وحده، وليس محاكاة كاملة للقرار الحي.",
  ];
}

/**
 * Walks the base 5M series forward bar by bar (checking for a new signal
 * every 3 bars ≈ one 15M close), calling the exact same buildDecision()
 * used live — so a positive/negative backtest result reflects the real
 * production logic, not a separate approximation of it. When a BUY/SELL
 * fires, the trade is simulated forward against the real subsequent 5M
 * bars until SL or TP1 is hit (or a timeout cap), then scanning resumes
 * after that trade closes.
 */
export function runBacktest(candles5m: Candle[]): BacktestResult {
  if (candles5m.length < 500) {
    return {
      trades: [],
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      profitFactor: null,
      expectancyR: 0,
      maxDrawdownR: 0,
      avgWinDurationMinutes: null,
      avgLossDurationMinutes: null,
      tp1HitRatePct: null,
      tp2HitRatePct: null,
      tp3HitRatePct: null,
      periodStart: candles5m[0]?.time ?? null,
      periodEnd: candles5m[candles5m.length - 1]?.time ?? null,
      caveats: ["بيانات تاريخية غير كافية (أقل من 500 شمعة 5M) لإجراء اختبار ذو دلالة."],
    };
  }

  const trades: BacktestTrade[] = [];
  const stepFactor = 3;
  const warmup = 300; // enough history for EMA50/ADX14/swing detection to be meaningful
  const maxHoldBars = 500; // ~41 hours of 5M bars — a trade left open longer than this counts as "timeout", not a fabricated outcome

  // Resampling chunks deterministically from index 0 in fixed-size groups,
  // so resample(candles5m.slice(0, i), factor) is always exactly equal to
  // resample(candles5m, factor).slice(0, floor(i / factor)) — no bar past
  // index i can ever influence a chunk that starts before it. That means
  // the full higher-timeframe series can be computed ONCE up front, and
  // each iteration below just takes a prefix slice (O(1)) instead of
  // re-resampling the whole growing prefix from scratch every step
  // (previously O(i) per step, O(n²) total — the dominant cost once a
  // deep-paginated series reaches tens of thousands of 5M bars).
  const c15Full = resample(candles5m, 3);
  const c30Full = resample(candles5m, 6);
  const c1hFull = resample(candles5m, 12);
  const c4hFull = resample(candles5m, 48);
  const cDailyFull = resample(candles5m, 288);

  let i = warmup;
  while (i < candles5m.length) {
    const c15 = c15Full.slice(0, Math.floor(i / 3));
    const c30 = c30Full.slice(0, Math.floor(i / 6));
    const c1h = c1hFull.slice(0, Math.floor(i / 12));
    const c4h = c4hFull.slice(0, Math.floor(i / 48));
    const cDaily = cDailyFull.slice(0, Math.floor(i / 288));

    if (c15.length < 30 || c4h.length < 30) {
      i += stepFactor;
      continue;
    }

    const price = candles5m[i - 1].close;
    const decision = buildDecision({
      price,
      candles4h: c4h,
      candles1h: c1h,
      candles30m: c30,
      candles15m: c15,
      candles5m: candles5m.slice(Math.max(0, i - 200), i),
      dailyCandles: cDaily.length > 0 ? cDaily : null,
      macro: { us10yTrend: null, dxyTrend: null },
      dataIssues: [],
    });

    if (decision.decision === "wait" || !decision.stopLoss || decision.tp1 == null) {
      i += stepFactor;
      continue;
    }

    const direction = decision.decision;
    const entryPrice = price;
    const entryTime = candles5m[i - 1].time;
    const sl = decision.stopLoss;
    const tp1 = decision.tp1;
    const tp2 = decision.tp2;
    const tp3 = decision.tp3;
    const regimeAtEntry = decision.regime?.regime ?? null;
    const halfSpread = spreadForEntry(entryTime) / 2;

    let outcome: BacktestTrade["outcome"] = "timeout";
    let exitPrice = entryPrice;
    let exitIdx = i;

    const forwardLimit = Math.min(candles5m.length, i + maxHoldBars);
    for (let j = i + 1; j < forwardLimit; j++) {
      const bar = candles5m[j];
      exitIdx = j;
      exitPrice = bar.close;
      if (direction === "buy") {
        if (bar.low <= sl) { outcome = "sl"; exitPrice = sl; break; }
        if (bar.high >= tp1) { outcome = "tp1"; exitPrice = tp1; break; }
      } else {
        if (bar.high >= sl) { outcome = "sl"; exitPrice = sl; break; }
        if (bar.low <= tp1) { outcome = "tp1"; exitPrice = tp1; break; }
      }
    }

    // TP2/TP3 are checked independently of the primary SL/TP1 outcome
    // above: once TP1 secures the trade (and the exit playbook says to
    // move the stop to breakeven there), whether price *also* later
    // reaches TP2/TP3 is its own real historical question, not
    // dependent on the R-multiple math already computed.
    let tp1Hit = outcome === "tp1";
    let tp2Hit = false;
    let tp3Hit = false;
    if (tp1Hit && tp2 != null && tp3 != null) {
      for (let j = exitIdx + 1; j < forwardLimit; j++) {
        const bar = candles5m[j];
        if (direction === "buy") {
          if (bar.high >= tp2) tp2Hit = true;
          if (bar.high >= tp3) tp3Hit = true;
        } else {
          if (bar.low <= tp2) tp2Hit = true;
          if (bar.low <= tp3) tp3Hit = true;
        }
        if (tp3Hit) break;
      }
    }

    // Crossing the spread on both legs: a buy pays the ask going in (higher)
    // and receives the bid going out (lower); a sell is the mirror image.
    const effectiveEntryPrice = direction === "buy" ? entryPrice + halfSpread : entryPrice - halfSpread;
    const effectiveExitPrice = direction === "buy" ? exitPrice - halfSpread : exitPrice + halfSpread;

    const risk = Math.abs(effectiveEntryPrice - sl);
    const reward = direction === "buy" ? effectiveExitPrice - effectiveEntryPrice : effectiveEntryPrice - effectiveExitPrice;
    const rMultiple = risk > 0 ? Number((reward / risk).toFixed(3)) : 0;

    trades.push({
      direction,
      entryTime,
      entryPrice,
      effectiveEntryPrice: Number(effectiveEntryPrice.toFixed(2)),
      stopLoss: sl,
      tp1,
      exitTime: candles5m[exitIdx]?.time ?? entryTime,
      exitPrice,
      effectiveExitPrice: Number(effectiveExitPrice.toFixed(2)),
      outcome,
      rMultiple,
      regimeAtEntry,
      tp1Hit,
      tp2Hit,
      tp3Hit,
    });

    i = exitIdx + 1;
  }

  const wins = trades.filter((t) => t.rMultiple > 0).length;
  const losses = trades.filter((t) => t.rMultiple <= 0).length;
  const grossWin = trades.filter((t) => t.rMultiple > 0).reduce((s, t) => s + t.rMultiple, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.rMultiple <= 0).reduce((s, t) => s + t.rMultiple, 0));
  const winRate = trades.length > 0 ? wins / trades.length : 0;
  const profitFactor = grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null;
  const expectancyR = trades.length > 0 ? Number((trades.reduce((s, t) => s + t.rMultiple, 0) / trades.length).toFixed(3)) : 0;

  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  for (const t of trades) {
    equity += t.rMultiple;
    peak = Math.max(peak, equity);
    maxDD = Math.min(maxDD, equity - peak);
  }

  const durationMinutes = (t: BacktestTrade) => (t.exitTime - t.entryTime) / 60_000;
  const winTrades = trades.filter((t) => t.rMultiple > 0);
  const lossTrades = trades.filter((t) => t.rMultiple <= 0);
  const avgWinDurationMinutes = winTrades.length > 0 ? Math.round(winTrades.reduce((s, t) => s + durationMinutes(t), 0) / winTrades.length) : null;
  const avgLossDurationMinutes = lossTrades.length > 0 ? Math.round(lossTrades.reduce((s, t) => s + durationMinutes(t), 0) / lossTrades.length) : null;

  const tp1HitRatePct = trades.length > 0 ? Math.round((trades.filter((t) => t.tp1Hit).length / trades.length) * 100) : null;
  const tp2HitRatePct = trades.length > 0 ? Math.round((trades.filter((t) => t.tp2Hit).length / trades.length) * 100) : null;
  const tp3HitRatePct = trades.length > 0 ? Math.round((trades.filter((t) => t.tp3Hit).length / trades.length) * 100) : null;

  return {
    trades,
    totalTrades: trades.length,
    wins,
    losses,
    winRate: Number((winRate * 100).toFixed(1)),
    profitFactor,
    expectancyR,
    avgWinDurationMinutes,
    avgLossDurationMinutes,
    tp1HitRatePct,
    tp2HitRatePct,
    tp3HitRatePct,
    maxDrawdownR: Number(Math.abs(maxDD).toFixed(2)),
    periodStart: candles5m[0]?.time ?? null,
    periodEnd: candles5m[candles5m.length - 1]?.time ?? null,
    caveats: buildCaveats(candles5m),
  };
}
