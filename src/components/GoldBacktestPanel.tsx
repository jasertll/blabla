"use client";

import { useState } from "react";
import { FlaskConical, ChevronDown, ChevronUp, Loader2, AlertTriangle } from "lucide-react";

type RegimeValidation = {
  regime: string;
  label: string;
  sufficiency: { tier: string; tradeCount: number; regimesRepresented: number; daySpan: number; notes: string[] };
  bootstrap: { expectancyMean: number; expectancyCI: [number, number]; profitFactorMean: number | null; profitFactorCI: [number | null, number | null] } | null;
  qualifies: boolean;
  qualifiesReason: string;
};

type IntegrityReport = {
  timeframe: string;
  bars: number;
  oldest: number | null;
  newest: number | null;
  calendarSpanDays: number;
  duplicateBars: number;
  outOfOrder: number;
  unexpectedGaps: { fromTime: number; toTime: number; gapMinutes: number }[];
  valid: boolean;
  notes: string[];
};

type BacktestResult = {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number | null;
  expectancyR: number;
  maxDrawdownR: number;
  avgWinDurationMinutes: number | null;
  avgLossDurationMinutes: number | null;
  periodStart: number | null;
  periodEnd: number | null;
  caveats: string[];
  regimeBreakdown?: RegimeValidation[];
  servedBy?: string | null;
  candleCount?: number;
  freshFetchCount?: number;
  historicalStore?: { configured: boolean; accumulatedBars: number | null };
  integrityReport?: IntegrityReport | null;
  configPromotionLog?: string[];
};

function fmtDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDuration(minutes: number | null): string {
  if (minutes == null) return "غير متوفر";
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} ساعة و${rest} دقيقة` : `${hours} ساعة`;
}

export default function GoldBacktestPanel() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gold/backtest", { cache: "no-store" });
      const json = await res.json();
      if (json.error) {
        setError(json.error);
      } else {
        setResult(json);
      }
      setRan(true);
    } catch {
      setError("تعذّر تشغيل الاختبار التاريخي.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass-panel p-4 space-y-3">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center justify-between w-full">
        <span className="flex items-center gap-2 text-sm font-display font-semibold text-slate-100">
          <FlaskConical className="h-4 w-4 text-accent" />
          اختبار تاريخي (Backtest) — مرحلة 2
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>

      {open && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500 leading-relaxed">
            بيشغّل نفس منطق القرار الحالي (باطنياً، الكود تماماً) على بيانات XAU/USD تاريخية حقيقية (شموع 5 دقائق،
            حتى 5000 شمعة ضمن حدود الخطة المجانية)، ويحاكي كل صفقة كانت راح تفتح لمعرفة هل كانت تربح أو تخسر فعلياً.
            هذا اختبار أولي (in-sample) فقط لمعرفة إذا كان في أساساً أي "ميزة" (edge) حقيقية بالمنطق الحالي — مش
            نتيجة نهائية موثوقة إحصائياً بعد.
          </p>

          {!ran && (
            <button
              onClick={run}
              disabled={loading}
              className="flex items-center gap-2 text-xs px-3 py-2 rounded-md border border-accent/50 bg-accent/10 text-accent-glow hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
              {loading ? "جاري تشغيل الاختبار…" : "شغّل الاختبار التاريخي"}
            </button>
          )}

          {error && (
            <div className="flex items-start gap-2 text-xs text-amber-300/90 bg-amber-900/10 border border-amber-700/30 rounded-lg p-2.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {result && (
            <>
              {result.totalTrades === 0 ? (
                <p className="text-xs text-slate-500">لا توجد بيانات كافية أو لم يتكوّن أي إعداد دخول ضمن الفترة المتاحة.</p>
              ) : (
                <>
                  <p className="text-[11px] text-slate-500">
                    الفترة المغطاة: {fmtDate(result.periodStart)} → {fmtDate(result.periodEnd)} · عدد الصفقات المحاكاة: {result.totalTrades}
                    {result.servedBy && (
                      <>
                        {" · "}مصدر البيانات: <span className="text-slate-300">{result.servedBy}</span>
                        {result.candleCount != null && ` (${result.candleCount.toLocaleString("en-US")} شمعة 5M)`}
                      </>
                    )}
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="glass-panel p-3">
                      <p className="text-[10px] text-slate-500 uppercase">نسبة الربح</p>
                      <p className={`text-lg font-display font-bold ${result.winRate >= 50 ? "text-emerald-300" : "text-orange-300"}`}>{result.winRate}%</p>
                      <p className="text-[10px] text-slate-600">{result.wins} رابحة / {result.losses} خاسرة</p>
                    </div>
                    <div className="glass-panel p-3">
                      <p className="text-[10px] text-slate-500 uppercase">Profit Factor</p>
                      <p className={`text-lg font-display font-bold ${result.profitFactor != null && result.profitFactor >= 1.5 ? "text-emerald-300" : "text-orange-300"}`}>
                        {result.profitFactor != null ? result.profitFactor : "—"}
                      </p>
                    </div>
                    <div className="glass-panel p-3">
                      <p className="text-[10px] text-slate-500 uppercase">Expectancy</p>
                      <p className={`text-lg font-display font-bold ${result.expectancyR >= 0 ? "text-emerald-300" : "text-red-300"}`}>{result.expectancyR}R</p>
                    </div>
                    <div className="glass-panel p-3">
                      <p className="text-[10px] text-slate-500 uppercase">أقصى تراجع</p>
                      <p className="text-lg font-display font-bold text-red-300">-{result.maxDrawdownR}R</p>
                    </div>
                    <div className="glass-panel p-3">
                      <p className="text-[10px] text-slate-500 uppercase">متوسط مدة الصفقة الرابحة</p>
                      <p className="text-sm font-display font-bold text-emerald-300">{fmtDuration(result.avgWinDurationMinutes)}</p>
                    </div>
                    <div className="glass-panel p-3">
                      <p className="text-[10px] text-slate-500 uppercase">متوسط مدة الصفقة الخاسرة</p>
                      <p className="text-sm font-display font-bold text-red-300">{fmtDuration(result.avgLossDurationMinutes)}</p>
                    </div>
                  </div>
                </>
              )}
              <ul className="text-[11px] text-slate-500 space-y-1 list-disc pr-4">
                {result.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>

              {(result.historicalStore || result.integrityReport) && (
                <div className="glass-panel p-3 border border-border/60 text-xs space-y-2">
                  <p className="text-slate-300 font-semibold">التخزين التاريخي والتحقق من سلامة البيانات</p>
                  {result.historicalStore && (
                    <p className="text-slate-400">
                      {result.historicalStore.configured ? (
                        <>
                          مخزّن تراكمي (Upstash Redis): <span className="font-mono text-slate-200">{result.historicalStore.accumulatedBars?.toLocaleString("en-US") ?? "—"}</span> شمعة
                          متراكمة عبر التشغيلات السابقة
                          {result.freshFetchCount != null && (
                            <> (هذه التشغيلة جلبت <span className="font-mono">{result.freshFetchCount.toLocaleString("en-US")}</span> شمعة جديدة/محدَّثة فقط).</>
                          )}
                        </>
                      ) : (
                        "التخزين التراكمي غير مفعّل (UPSTASH_REDIS_REST_URL/TOKEN غير مضبوطين) — كل تشغيلة تعتمد فقط على الجلب الطازج، بدون تراكم عبر الأيام."
                      )}
                    </p>
                  )}
                  {result.integrityReport && (
                    <div className="space-y-1">
                      <p className={`font-mono ${result.integrityReport.valid ? "text-emerald-300" : "text-amber-300"}`}>
                        {result.integrityReport.valid ? "✓ سلسلة سليمة" : "⚠ مشاكل محتملة بالسلسلة"} — {result.integrityReport.bars.toLocaleString("en-US")} شمعة ·{" "}
                        {result.integrityReport.calendarSpanDays} يوم تقويمي · تكرار: {result.integrityReport.duplicateBars} · فجوات غير متوقعة:{" "}
                        {result.integrityReport.unexpectedGaps.length}
                      </p>
                      {result.integrityReport.notes.map((n, i) => (
                        <p key={i} className="text-slate-500">
                          {n}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {result.configPromotionLog && result.configPromotionLog.length > 0 && (
                <div className="glass-panel p-3 border border-border/60 text-xs space-y-1">
                  <p className="text-slate-300 font-semibold">تقييم ترقية الإعدادات (15M) من هذه التشغيلة</p>
                  <ul className="text-slate-500 space-y-1 list-disc pr-4">
                    {result.configPromotionLog.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.regimeBreakdown && result.regimeBreakdown.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-border/40">
                  <p className="text-xs font-semibold text-slate-300">التحقق الإحصائي حسب نظام السوق (Regime)</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    كل الصفوف هون من نفس اختبار فريم 15M أعلاه، مقسّمة حسب نظام السوق وقت فتح كل صفقة. "مؤهّل" يعني الحد الأدنى لفترة
                    الثقة (95%) للتوقع (Expectancy) أعلى من الصفر — دليل أولي حقيقي، مش قرار نهائي. هذا لا يغيّر إعدادات القرار الحالية
                    تلقائياً (تبقى BASELINE) — تحديث فعلي يحتاج مراجعة ومراقبة مستمرة، مش تشغيلة وحدة.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] border-collapse">
                      <thead>
                        <tr className="text-slate-500 text-right">
                          <th className="py-1.5 pr-2 font-normal">نظام السوق</th>
                          <th className="py-1.5 px-2 font-normal">عدد الصفقات</th>
                          <th className="py-1.5 px-2 font-normal">Expectancy (CI 95%)</th>
                          <th className="py-1.5 px-2 font-normal">الحالة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.regimeBreakdown.map((r) => (
                          <tr key={r.regime} className="border-t border-border/30">
                            <td className="py-1.5 pr-2 text-slate-300">{r.label}</td>
                            <td className="py-1.5 px-2 font-mono text-slate-400">{r.sufficiency.tradeCount}</td>
                            <td className="py-1.5 px-2 font-mono text-slate-400">
                              {r.bootstrap ? `${r.bootstrap.expectancyMean}R [${r.bootstrap.expectancyCI[0]}, ${r.bootstrap.expectancyCI[1]}]` : "—"}
                            </td>
                            <td className="py-1.5 px-2">
                              <span
                                className={`px-1.5 py-0.5 rounded border text-[10px] ${
                                  r.qualifies ? "text-emerald-300 border-emerald-700/40 bg-emerald-900/10" : "text-slate-500 border-border/60"
                                }`}
                                title={r.qualifiesReason}
                              >
                                {r.qualifies ? "مؤهّل" : "غير كافٍ"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <button onClick={run} disabled={loading} className="text-[11px] text-slate-500 hover:text-slate-300 underline">
                {loading ? "جاري إعادة التشغيل…" : "إعادة التشغيل"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
