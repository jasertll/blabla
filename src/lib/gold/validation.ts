import { assessSufficiency, type SufficiencyReport } from "@/lib/gold/dataSufficiency";
import { bootstrapTradeMetrics, type BootstrapResult } from "@/lib/gold/bootstrap";

export type RegimeValidation = {
  regime: string; // "ALL" for the aggregate, or the specific MarketRegime string
  label: string;
  sufficiency: SufficiencyReport;
  bootstrap: BootstrapResult | null;
  qualifies: boolean;
  qualifiesReason: string;
};

const REGIME_LABELS: Record<string, string> = {
  ALL: "كل الصفقات (بدون تصنيف نظام سوق)",
  strong_bull_trend: "اتجاه صاعد قوي",
  weak_bull_trend: "اتجاه صاعد ضعيف",
  strong_bear_trend: "اتجاه هابط قوي",
  weak_bear_trend: "اتجاه هابط ضعيف",
  range: "نطاق تذبذب",
  compression: "تجميع/انضغاط",
  breakout: "اختراق",
  high_volatility: "تقلب مرتفع",
  extreme_volatility: "تقلب شديد",
  unclear: "غير واضح",
};

/**
 * Groups already-simulated backtest trades by the regime active when each
 * one fired, and grades each group's evidence honestly — the same
 * sufficiency/bootstrap machinery the top-level backtest report already
 * uses, just scoped per regime, so "is this specific market condition
 * actually profitable" gets a real answer instead of being averaged away
 * into one aggregate number.
 *
 * This deliberately does NOT promote anything in configEngine's
 * CONFIG_REGISTRY automatically: there's no persistence layer here to
 * make a promotion durable across restarts, and a single backtest run
 * isn't the kind of ongoing, walk-forward monitoring a real promotion to
 * VALIDATED deserves (see configEngine.ts's own comments on this).
 * `qualifies` is a read-only signal for a human to review, not an
 * automatic status change — CONFIG_REGISTRY stays BASELINE either way.
 */
export function assessRegimeBreakdown(trades: { entryTime: number; regimeAtEntry: string | null; rMultiple: number }[]): RegimeValidation[] {
  const groups = new Map<string, typeof trades>();
  groups.set("ALL", trades);
  for (const t of trades) {
    const key = t.regimeAtEntry ?? "unclear";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  const out: RegimeValidation[] = [];
  for (const [regime, group] of groups) {
    if (regime !== "ALL" && group.length === 0) continue;
    const sufficiency = assessSufficiency(group.map((t) => ({ entryTime: t.entryTime, regimeAtEntry: t.regimeAtEntry })));
    const bootstrap = bootstrapTradeMetrics(group.map((t) => t.rMultiple));
    const qualifies =
      sufficiency.tier !== "INSUFFICIENT" &&
      bootstrap != null &&
      bootstrap.expectancyCI[0] > 0 &&
      (bootstrap.profitFactorCI[0] == null || bootstrap.profitFactorCI[0] > 1);
    const qualifiesReason = qualifies
      ? "الحد الأدنى لفترة الثقة (95%) للتوقع (Expectancy) أعلى من الصفر — دليل أولي حقيقي على وجود ميزة، مش مجرد حظ."
      : sufficiency.tier === "INSUFFICIENT"
      ? "عدد الصفقات غير كافٍ بعد لأي استنتاج."
      : "فترة الثقة (95%) للتوقع (Expectancy) تشمل الصفر أو أقل — ما في دليل كافٍ لميزة حقيقية بعد.";
    out.push({ regime, label: REGIME_LABELS[regime] ?? regime, sufficiency, bootstrap, qualifies, qualifiesReason });
  }

  return out.sort((a, b) => (a.regime === "ALL" ? -1 : b.regime === "ALL" ? 1 : b.sufficiency.tradeCount - a.sufficiency.tradeCount));
}
