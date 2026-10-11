import { getRedis } from "@/lib/redis";
import { CONFIG_REGISTRY, regimeToBucket, type ConfigProfile, type ConfigStatus, type ConfigConfidence, type RegimeBucket } from "@/lib/gold/configEngine";
import { assessSufficiency } from "@/lib/gold/dataSufficiency";
import { bootstrapTradeMetrics, type BootstrapResult } from "@/lib/gold/bootstrap";

// The actual promotion lifecycle configEngine.ts's ConfigStatus enum has
// always documented but never implemented (its own comment: "No CANDIDATE
// or VALIDATED entries exist yet, on purpose"). This is that path — but
// still an honest one: a single backtest run's positive result promotes a
// profile to CANDIDATE at most, never straight to VALIDATED. Reaching
// VALIDATED requires the SAME (timeframe, regime) config to independently
// qualify again on a later run, spaced calendar days apart, so a single
// lucky backtest can never validate anything by itself. If a later run
// stops qualifying, a CANDIDATE/VALIDATED profile is demoted to DEGRADED
// rather than silently staying at its last-known-good status forever.
//
// This is deliberately NOT full walk-forward optimization (see
// backtestEngine.ts/validation.ts's own notes on that gap) — there's no
// parameter fitting happening anywhere in this system to begin with (the
// indicator periods are fixed expert-baseline values, never optimized
// against this data), so the traditional train/test overfitting risk
// walk-forward protects against doesn't apply the same way here. What
// this DOES check for honestly: whether the same edge shows up
// independently in the earlier and later half of the sample (not just
// one lucky stretch), and whether it keeps showing up across separate,
// calendar-spaced runs (not just one run's random seed).

const REGISTRY_KEY = "gold:configRegistry:v1";
const HISTORY_KEY_PREFIX = "gold:configPromotionHistory:v1";
const MIN_QUALIFYING_RUNS_FOR_VALIDATED = 2;
const MIN_DAYS_BETWEEN_QUALIFYING_RUNS = 14;
const REGIME_BUCKETS: RegimeBucket[] = ["ANY", "TREND", "RANGE", "COMPRESSION", "HIGH_VOL"];

export type PromotionRunRecord = { at: number; qualifies: boolean; tradeCount: number; expectancyCI: [number, number] | null };

type TradeForPromotion = { entryTime: number; regimeAtEntry: string | null; rMultiple: number };

function meetsEvidenceBar(sufficiency: ReturnType<typeof assessSufficiency>, bootstrap: BootstrapResult | null): boolean {
  return (
    sufficiency.tier !== "INSUFFICIENT" &&
    bootstrap != null &&
    bootstrap.expectancyCI[0] > 0 &&
    (bootstrap.profitFactorCI[0] == null || bootstrap.profitFactorCI[0] > 1)
  );
}

/**
 * Reads the persisted registry (Redis), falling back to the static
 * expert-baseline CONFIG_REGISTRY for any profile it doesn't have yet
 * (a fresh Upstash database, or a bucket added to the code later) and for
 * everything if Redis isn't configured at all — never throws, never
 * returns an empty registry.
 */
export async function loadConfigRegistry(): Promise<ConfigProfile[]> {
  const redis = getRedis();
  if (!redis) return CONFIG_REGISTRY;
  try {
    const stored = await redis.get<ConfigProfile[]>(REGISTRY_KEY);
    if (!stored || stored.length === 0) return CONFIG_REGISTRY;
    const byId = new Map(stored.map((c) => [c.id, c]));
    return CONFIG_REGISTRY.map((base) => byId.get(base.id) ?? base);
  } catch {
    return CONFIG_REGISTRY;
  }
}

/**
 * Runs after a real backtest, once per (timeframe, regime bucket) that
 * had trades in this run. Grades this run's evidence, checks split-period
 * stability (does the edge hold in both the earlier and later half of the
 * sample), records the verdict into that profile's rolling run history,
 * and updates status accordingly. Persists both the updated registry and
 * each profile's run history to Redis. If Redis isn't configured, this is
 * a no-op that returns the static registry unchanged — same as today.
 */
export async function evaluatePromotions(timeframe: string, trades: TradeForPromotion[]): Promise<{ registry: ConfigProfile[]; log: string[] }> {
  const redis = getRedis();
  const registry = await loadConfigRegistry();
  const log: string[] = [];

  if (!redis) {
    log.push("Upstash Redis غير مضبوط — لا يمكن حفظ ترقيات الإعدادات بشكل دائم؛ كل الإعدادات تبقى BASELINE كما كانت.");
    return { registry, log };
  }

  const updated: ConfigProfile[] = [...registry];

  for (const bucket of REGIME_BUCKETS) {
    const id = `CONFIG-${timeframe}-${bucket}-EXPERT`;
    const idx = updated.findIndex((c) => c.id === id);
    if (idx === -1) continue;

    const group = bucket === "ANY" ? trades : trades.filter((t) => regimeToBucket(t.regimeAtEntry) === bucket);
    if (group.length === 0) continue;

    const sufficiency = assessSufficiency(group.map((t) => ({ entryTime: t.entryTime, regimeAtEntry: t.regimeAtEntry })));
    const bootstrap = bootstrapTradeMetrics(group.map((t) => t.rMultiple));
    const fullQualifies = meetsEvidenceBar(sufficiency, bootstrap);

    const sortedByTime = [...group].sort((a, b) => a.entryTime - b.entryTime);
    const mid = Math.floor(sortedByTime.length / 2);
    const halfQualifies = (half: TradeForPromotion[]) => {
      if (half.length === 0) return false;
      const s = assessSufficiency(half.map((t) => ({ entryTime: t.entryTime, regimeAtEntry: t.regimeAtEntry })));
      const b = bootstrapTradeMetrics(half.map((t) => t.rMultiple));
      return meetsEvidenceBar(s, b);
    };
    const splitStable = fullQualifies && halfQualifies(sortedByTime.slice(0, mid)) && halfQualifies(sortedByTime.slice(mid));

    const historyKey = `${HISTORY_KEY_PREFIX}:${id}`;
    let history: PromotionRunRecord[] = [];
    try {
      history = (await redis.get<PromotionRunRecord[]>(historyKey)) ?? [];
    } catch {
      /* degrade to empty history for this run */
    }

    history = [...history, { at: Date.now(), qualifies: splitStable, tradeCount: group.length, expectancyCI: bootstrap?.expectancyCI ?? null }].slice(-20);

    const qualifyingRuns = history.filter((r) => r.qualifies);
    const spanDays =
      qualifyingRuns.length > 1 ? (Math.max(...qualifyingRuns.map((r) => r.at)) - Math.min(...qualifyingRuns.map((r) => r.at))) / (24 * 60 * 60_000) : 0;

    const current = updated[idx];
    let nextStatus: ConfigStatus;
    let nextConfidence: ConfigConfidence;
    let message: string;

    if (!fullQualifies) {
      nextStatus = current.status === "VALIDATED" || current.status === "CANDIDATE" ? "DEGRADED" : "BASELINE";
      nextConfidence = "INSUFFICIENT";
      message = `${id}: العيّنة الحالية لا تحقق شرط الأدلة (فترة الثقة تشمل الصفر، أو عدد صفقات غير كافٍ)${
        current.status !== "BASELINE" && current.status !== "DEGRADED" ? ` — تراجع من ${current.status}` : ""
      }.`;
    } else if (qualifyingRuns.length >= MIN_QUALIFYING_RUNS_FOR_VALIDATED && spanDays >= MIN_DAYS_BETWEEN_QUALIFYING_RUNS) {
      nextStatus = "VALIDATED";
      nextConfidence = sufficiency.tier === "STRONG" ? "HIGH" : "MEDIUM";
      message = `${id}: ترقية إلى VALIDATED — ${qualifyingRuns.length} تشغيلات مستقلة مؤهّلة موزّعة على ${Math.round(spanDays)} يوم، مع استقرار عبر نصفي العيّنة الزمنيين.`;
    } else {
      nextStatus = "CANDIDATE";
      nextConfidence = sufficiency.tier === "PREFERRED" || sufficiency.tier === "STRONG" ? "MEDIUM" : "LOW";
      const remaining = Math.max(0, MIN_QUALIFYING_RUNS_FOR_VALIDATED - qualifyingRuns.length);
      message = `${id}: مؤهّل كـ CANDIDATE (أدلة إيجابية + استقرار عبر نصفي العيّنة) — يحتاج ${remaining || "المزيد من"} تشغيلة/تشغيلات مؤهّلة إضافية موزّعة على ${MIN_DAYS_BETWEEN_QUALIFYING_RUNS}+ يوم قبل VALIDATED.`;
    }

    log.push(message);
    updated[idx] = {
      ...current,
      status: nextStatus,
      confidence: nextConfidence,
      sampleTrades: group.length,
      outOfSamplePF: bootstrap?.profitFactorMean ?? null,
      outOfSampleExpectancy: bootstrap?.expectancyMean ?? null,
      lastValidatedAt: nextStatus === "VALIDATED" ? Date.now() : current.lastValidatedAt,
      notes: [...current.notes.filter((n) => !n.startsWith("[auto]")), `[auto] ${message}`],
    };

    try {
      await redis.set(historyKey, history);
    } catch {
      /* non-fatal — this run's history entry just won't persist */
    }
  }

  try {
    await redis.set(REGISTRY_KEY, updated);
  } catch {
    log.push("تعذّر حفظ سجل الإعدادات في Redis هذه المرة — التقييم أعلاه محسوب لكن لن يُحفظ حتى تشغيلة لاحقة ناجحة.");
  }

  return { registry: updated, log };
}
