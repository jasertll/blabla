"use client";

import { useEffect, useState } from "react";
import { LogIn, Loader2, CheckCircle2, XCircle, TrendingUp, Newspaper, ArrowLeftRight } from "lucide-react";
import type { GoldDecisionOutput } from "@/lib/gold/types";
import { fmtDuration } from "@/components/GoldBacktestPanel";
import GoldAdviceBox from "@/components/GoldAdviceBox";

const ENTRY_QUALITY_LABELS: Record<string, string> = { EXCELLENT: "ممتازة", GOOD: "جيدة", FAIR: "مقبولة", POOR: "ضعيفة" };
const ENTRY_QUALITY_TONE: Record<string, string> = { EXCELLENT: "text-emerald-300", GOOD: "text-emerald-300", FAIR: "text-amber-300", POOR: "text-red-300" };
const SL_QUALITY_LABELS: Record<string, string> = { TIGHT: "ضيّق", NORMAL: "طبيعي", WIDE: "واسع", EXTREME: "واسع جداً" };
const SL_QUALITY_TONE: Record<string, string> = { TIGHT: "text-amber-300", NORMAL: "text-emerald-300", WIDE: "text-amber-300", EXTREME: "text-red-300" };
const QUALITY_RANK: Record<string, number> = { EXCELLENT: 4, GOOD: 3, FAIR: 2, POOR: 1 };
const ALL_TIMEFRAMES = ["5M", "15M", "30M", "1H", "4H"] as const;

type BacktestSummary = {
  totalTrades: number;
  winRate: number;
  profitFactor: number | null;
  expectancyR: number;
  avgWinDurationMinutes: number | null;
  tp1HitRatePct: number | null;
  tp2HitRatePct: number | null;
  tp3HitRatePct: number | null;
} | null;

type TfCandidate = { tf: string; decision: GoldDecisionOutput };

function rankOf(d: GoldDecisionOutput): number {
  if (d.decision === "wait") return 0;
  return d.entryQuality ? QUALITY_RANK[d.entryQuality] ?? 0 : 0;
}

export function fmtAge(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} ثانية`;
  return `${Math.round(seconds / 60)} دقيقة`;
}

export default function GoldEntryCheck({
  primaryTf = "15M",
  onSwitchTimeframe,
}: {
  primaryTf?: string;
  onSwitchTimeframe?: (tf: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [decision, setDecision] = useState<GoldDecisionOutput | null>(null);
  const [backtest, setBacktest] = useState<BacktestSummary>(null);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [betterTf, setBetterTf] = useState<TfCandidate | null>(null);

  async function runCheck() {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const otherTfs = ALL_TIMEFRAMES.filter((tf) => tf !== primaryTf);
      const [decisionRes, backtestRes, ...otherResList] = await Promise.all([
        fetch(`/api/gold/decision?tf=${primaryTf}`, { cache: "no-store" }),
        fetch("/api/gold/backtest", { cache: "no-store" }),
        ...otherTfs.map((tf) => fetch(`/api/gold/decision?tf=${tf}`, { cache: "no-store" })),
      ]);
      const decisionJson = await decisionRes.json();
      setDecision(decisionJson);

      // Cross-timeframe comparison: candle history is server-cached per
      // timeframe already, so checking the other four costs no extra
      // provider credits — just re-reads what's already in cache. If
      // another timeframe currently has a materially cleaner setup, say so
      // instead of leaving her to discover it by clicking through tabs.
      const otherDecisions = await Promise.all(otherResList.map((r) => r.json()));
      const candidates: TfCandidate[] = otherTfs.map((tf, idx) => ({ tf, decision: otherDecisions[idx] as GoldDecisionOutput }));
      const primaryRank = rankOf(decisionJson as GoldDecisionOutput);
      const best = candidates
        .filter((c) => rankOf(c.decision) > primaryRank && rankOf(c.decision) >= QUALITY_RANK.GOOD)
        .sort((a, b) => rankOf(b.decision) - rankOf(a.decision))[0];
      setBetterTf(best ?? null);

      const backtestJson = await backtestRes.json();
      if (backtestJson.error) {
        setBacktestError(backtestJson.error);
        setBacktest(null);
      } else if (backtestJson.totalTrades > 0) {
        setBacktest(backtestJson);
        setBacktestError(null);
      } else {
        setBacktestError("لا توجد صفقات كافية بالاختبار التاريخي بعد.");
      }
    } catch {
      setError("تعذّر إجراء الفحص الآن.");
    } finally {
      setLoading(false);
    }
  }

  // Re-run automatically when the primary timeframe changes while the
  // panel is already open — including right after the user presses the
  // "switch to this timeframe" button below.
  useEffect(() => {
    if (open) runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryTf]);

  const verdict = decision?.decision;
  const isGo = verdict === "buy" || verdict === "sell";
  const directionWord = verdict === "buy" ? "شراء" : verdict === "sell" ? "بيع" : null;

  return (
    <div className="glass-panel p-4 space-y-3 border-2 border-accent/30">
      <button
        onClick={runCheck}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 text-sm font-display font-bold px-4 py-3 rounded-lg bg-accent/15 border border-accent/50 text-accent-glow hover:bg-accent/25 transition-colors disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
        {loading ? "جاري الفحص…" : "هل أدخل الآن؟"}
      </button>

      {error && <p className="text-xs text-red-300">{error}</p>}

      {open && !loading && decision && (
        <div className="space-y-3">
          {decision.price != null && (
            <div
              className={`flex items-center justify-between text-xs rounded-lg px-3 py-2 border ${
                decision.priceAsOf != null && Date.now() - decision.priceAsOf > 90_000
                  ? "text-amber-300 bg-amber-950/20 border-amber-700/30"
                  : "text-slate-400 bg-surface-elevated border-border/60"
              }`}
            >
              <span>
                السعر المستخدم بالحساب: <span className="font-mono font-semibold">{decision.price.toFixed(2)}</span>
              </span>
              <span>{decision.priceAsOf != null ? `آخر تحديث فعلي: قبل ${fmtAge(Date.now() - decision.priceAsOf)}` : "وقت تحديث السعر غير معروف"}</span>
            </div>
          )}

          {decision.newsBlackoutReason ? (
            <div className="flex items-center gap-2 text-red-300 bg-red-900/20 border border-red-600/40 rounded-xl px-4 py-3">
              <XCircle className="h-6 w-6 shrink-0" />
              <div>
                <p className="font-display font-bold">⛔ لا تدخل الآن</p>
                <p className="text-xs text-red-300/80 mt-0.5">{decision.newsBlackoutReason}</p>
              </div>
            </div>
          ) : isGo ? (
            <div className="flex items-start gap-2 text-emerald-300 bg-emerald-900/20 border border-emerald-600/40 rounded-xl px-4 py-3">
              <CheckCircle2 className="h-6 w-6 shrink-0 mt-0.5" />
              <div className="w-full">
                <p className="font-display font-bold text-lg">✅ دخول {directionWord} الآن — {verdict === "buy" ? "🟢 شراء" : "🔴 بيع"} على فريم <bdi>{primaryTf}</bdi></p>
                <p className="text-xs text-emerald-300/80 mt-0.5">جودة الإعداد: {decision.quality} · Signal Score: {decision.signalScore}/100</p>
                {decision.stopLoss != null && decision.tp1 != null && (
                  <p className="text-sm font-mono font-semibold text-emerald-200 mt-2 bg-emerald-950/40 border border-emerald-700/30 rounded-lg px-2.5 py-1.5">
                    سكّر عند وصول السعر لـ {decision.tp1.toFixed(2)} (TP1) — وألغِ الصفقة فوراً لو رجع السعر لمس {decision.stopLoss.toFixed(2)} (وقف الخسارة).
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-slate-300 bg-surface-elevated border border-border rounded-xl px-4 py-3">
              <XCircle className="h-6 w-6 shrink-0 text-orange-300" />
              <p className="font-display font-bold text-lg">
                ⏳ لا تدخل الآن على فريم <bdi>{primaryTf}</bdi>
              </p>
            </div>
          )}

          <GoldAdviceBox decision={decision} />

          {betterTf && (
            <div className="flex items-center justify-between gap-3 text-xs text-accent-glow bg-accent/10 border border-accent/40 rounded-xl px-4 py-3">
              <div className="flex items-start gap-2">
                <ArrowLeftRight className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-display font-semibold">
                    أتوقع فريمك الحالي (<bdi>{primaryTf}</bdi>) مش الأنسب الآن — فريم <bdi>{betterTf.tf}</bdi> فيه إعداد أوضح (
                    {betterTf.decision.decision === "buy" ? "دخول شراء" : "دخول بيع"}، جودة موقع{" "}
                    {ENTRY_QUALITY_LABELS[betterTf.decision.entryQuality ?? ""] ?? "—"}).
                  </p>
                </div>
              </div>
              {onSwitchTimeframe && (
                <button
                  onClick={() => onSwitchTimeframe(betterTf.tf)}
                  className="shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-md bg-accent/25 border border-accent/60 hover:bg-accent/35 transition-colors"
                >
                  افحص فريم <bdi>{betterTf.tf}</bdi>
                </button>
              )}
            </div>
          )}

          <div className="glass-panel p-3 border border-border/60">
            <p className="text-xs text-slate-500 mb-1">تقدير اتجاه السوق (منفصل عن قرار الدخول)</p>
            <p
              className={`text-sm font-display font-bold ${
                decision.directionEstimate.direction === "bullish" ? "text-emerald-300" : decision.directionEstimate.direction === "bearish" ? "text-red-300" : "text-slate-400"
              }`}
            >
              {decision.directionEstimate.direction === "bullish" ? "صاعد" : decision.directionEstimate.direction === "bearish" ? "هابط" : "محايد"}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {decision.directionEstimate.bullVotes} من {decision.directionEstimate.totalFrames} فريمات مالت صاعد · {decision.directionEstimate.bearVotes} من{" "}
              {decision.directionEstimate.totalFrames} مالت هابط
              <span className="text-slate-600"> (والباقي محايد) — مش نسبة احتمال ولا إلها نقيض</span>
            </p>
            <p className="text-[10px] text-slate-600 mt-0.5">{decision.directionEstimate.basis}</p>
          </div>

          {decision.entryZone && (
            <div className="glass-panel p-3 border border-accent/40">
              <p className="text-xs text-slate-500 mb-1">{isGo ? "السعر بالضبط للدخول" : "منطقة الدخول المثالية (انتظر الوصول إليها)"}</p>
              <p className="text-xl font-mono font-bold text-accent-glow">
                {decision.entryZone[0].toFixed(2)} – {decision.entryZone[1].toFixed(2)}
              </p>
              {decision.price != null && (
                <p className="text-[11px] text-slate-500 mt-1">
                  {Math.abs(decision.entryZone[0] - decision.price) < Math.abs(decision.entryZone[1] - decision.price)
                    ? `اندفاعي (أقرب للسعر الحالي): ${decision.entryZone[0].toFixed(2)} · محافظ: ${decision.entryZone[1].toFixed(2)}`
                    : `اندفاعي (أقرب للسعر الحالي): ${decision.entryZone[1].toFixed(2)} · محافظ: ${decision.entryZone[0].toFixed(2)}`}
                </p>
              )}
              <div className="flex gap-3 mt-2">
                {decision.entryQuality && (
                  <span className={`text-[11px] ${ENTRY_QUALITY_TONE[decision.entryQuality]}`}>جودة الموقع: {ENTRY_QUALITY_LABELS[decision.entryQuality]}</span>
                )}
                {decision.slQuality && <span className={`text-[11px] ${SL_QUALITY_TONE[decision.slQuality]}`}>وقف الخسارة: {SL_QUALITY_LABELS[decision.slQuality]}</span>}
              </div>
            </div>
          )}

          {decision.exitPlan.length > 0 && (
            <div className="glass-panel p-3 border border-emerald-700/30">
              <p className="text-xs text-slate-300 font-semibold mb-1.5">امتى أطلع؟ (خطة الخروج)</p>
              <ul className="text-xs text-slate-400 space-y-1.5 list-disc pr-4">
                {decision.exitPlan.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ul>

              {backtest && backtest.tp1HitRatePct != null && (
                <div className="mt-3 pt-3 border-t border-border/40">
                  <p className="text-[11px] text-slate-500 mb-1.5">نسبة نجاح كل نقطة سعر تاريخياً (من الاختبار التاريخي)</p>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="glass-panel py-1.5">
                      <p className="text-[10px] text-slate-500">
                        TP1 ({decision.tp1 != null ? decision.tp1.toFixed(2) : "—"})
                      </p>
                      <p className="text-sm font-mono font-bold text-emerald-300">{backtest.tp1HitRatePct}%</p>
                    </div>
                    <div className="glass-panel py-1.5">
                      <p className="text-[10px] text-slate-500">
                        TP2 ({decision.tp2 != null ? decision.tp2.toFixed(2) : "—"})
                      </p>
                      <p className="text-sm font-mono font-bold text-emerald-300">{backtest.tp2HitRatePct ?? "—"}%</p>
                    </div>
                    <div className="glass-panel py-1.5">
                      <p className="text-[10px] text-slate-500">
                        TP3 ({decision.tp3 != null ? decision.tp3.toFixed(2) : "—"})
                      </p>
                      <p className="text-sm font-mono font-bold text-emerald-300">{backtest.tp3HitRatePct ?? "—"}%</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-600 mt-1.5 leading-relaxed">
                    TP1 = نسبة الصفقات التاريخية التي وصلت فعلاً للهدف الأول. TP2/TP3 = من بين تلك الصفقات، نسبة
                    اللي كملت ووصلت للهدف الثاني/الثالث قبل الرجوع (عادة بعد ما ينتقل وقف الخسارة لنقطة التعادل).
                    عدد الصفقات محدود ({backtest.totalTrades}) — النسب تقريبية وليست احتمالاً مضموناً.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex items-start gap-2 text-xs text-slate-400 bg-surface-elevated border border-border/60 rounded-lg p-2.5">
            <TrendingUp className="h-3.5 w-3.5 shrink-0 mt-0.5 text-accent" />
            <div>
              <p className="text-slate-300 font-semibold mb-0.5">نسبة النجاح التاريخية + مدة الصفقة المتوقعة</p>
              {backtest ? (
                <p>
                  {backtest.winRate}% نسبة ربح، من {backtest.totalTrades} صفقة محاكاة تاريخياً (اختبار داخل نفس
                  العيّنة فقط — راجع لوحة "اختبار تاريخي" بالأسفل للتفاصيل والتحفظات). هذا رقم عام للمنطق ككل، وليس
                  احتمال مخصص لهذه الصفقة بالذات.
                  <br />
                  متوسط مدة الصفقة الرابحة تاريخياً حتى الهدف الأول: <strong className="text-emerald-300">{fmtDuration(backtest.avgWinDurationMinutes)}</strong>.
                </p>
              ) : (
                <p className="text-slate-500">{backtestError ?? "غير متوفر — شغّل لوحة \"اختبار تاريخي\" بالأسفل أولاً."}</p>
              )}
            </div>
          </div>

          <a
            href="#gold-news-headlines"
            className="flex items-start gap-2 text-xs text-amber-300/90 bg-amber-900/10 border border-amber-700/30 rounded-lg p-2.5 hover:bg-amber-900/20 transition-colors"
          >
            <Newspaper className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              التقويم هون بيغطي بس FOMC/CPI/NFP/GDP/PCE/Jobless Claims — راجع عناوين الأخبار العالمية والسياسية
              بالأسفل يدوياً قبل أي قرار قرب أحداث جيوسياسية كبيرة (حروب، عقوبات، تصريحات مفاجئة).
            </span>
          </a>
        </div>
      )}
    </div>
  );
}
