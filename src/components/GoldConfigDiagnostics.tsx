"use client";

import { useState } from "react";
import { Microscope, ChevronDown, ChevronUp, Loader2, AlertTriangle } from "lucide-react";
import type { GoldDecisionOutput } from "@/lib/gold/types";

type Sufficiency = { tier: string; tradeCount: number; regimesRepresented: number; daySpan: number; notes: string[] };
type Bootstrap = {
  expectancyMean: number;
  expectancyCI: [number, number];
  profitFactorMean: number | null;
  profitFactorCI: [number | null, number | null];
  iterations: number;
  sampleSize: number;
} | null;

const STATUS_LABELS: Record<string, string> = {
  BASELINE: "أساسي (BASELINE)",
  CANDIDATE: "مرشّح (CANDIDATE)",
  VALIDATED: "محقّق (VALIDATED)",
  DEGRADED: "متدهور (DEGRADED)",
  REJECTED: "مرفوض (REJECTED)",
  INSUFFICIENT_DATA: "بيانات غير كافية",
};

const CONFIDENCE_TONE: Record<string, string> = {
  HIGH: "text-emerald-300",
  MEDIUM: "text-amber-300",
  LOW: "text-orange-300",
  INSUFFICIENT: "text-slate-500",
};

const TIER_LABELS: Record<string, string> = {
  INSUFFICIENT: "غير كافية",
  CANDIDATE_ELIGIBLE: "مؤهلة للترشيح",
  PREFERRED: "مفضّلة",
  STRONG: "قوية",
};

export default function GoldConfigDiagnostics({ decision }: { decision: GoldDecisionOutput | null }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sufficiency, setSufficiency] = useState<Sufficiency | null>(null);
  const [bootstrap, setBootstrap] = useState<Bootstrap>(null);
  const [error, setError] = useState<string | null>(null);
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
        setSufficiency(json.sufficiency ?? null);
        setBootstrap(json.bootstrap ?? null);
      }
      setRan(true);
    } catch {
      setError("تعذّر جلب أدلّة التحقق.");
    } finally {
      setLoading(false);
    }
  }

  const primary = decision?.configTrace.find((c) => c.timeframe === "15M");

  return (
    <div className="glass-panel p-4 space-y-3">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center justify-between w-full">
        <span className="flex items-center gap-2 text-sm font-display font-semibold text-slate-100">
          <Microscope className="h-4 w-4 text-accent" />
          تشخيص الإعدادات (Configuration Diagnostics)
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>

      {open && (
        <div className="space-y-4">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            يوضّح هذا القسم بالضبط أي إعداد مستخدَم حالياً لكل فريم، وحالته، والدليل الإحصائي وراءه (أو غيابه). القاعدة
            الصارمة: لا شي يُعتبر "محقّق (VALIDATED)" إلا بدليل حقيقي خارج العيّنة — وطالما ما توفر هذا الدليل، الإعداد
            يضل أساسي (BASELINE) بصراحة، بدل التظاهر بتحسين وهمي.
          </p>

          {primary && (
            <div className="glass-panel p-3 border border-border/60 space-y-1.5 text-xs">
              <p className="text-slate-300 font-semibold mb-1">الفريم الأساسي للقرار (15M)</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-400">
                <span>النظام الحالي: <span className="text-slate-200">{decision?.regime?.regime ?? "—"}</span></span>
                <span>الاستراتيجية المختارة: <span className="text-slate-200">{primary.strategyLabel}</span></span>
                <span>معرّف الإعداد: <span className="text-slate-200 font-mono">{primary.configId}</span></span>
                <span>حالة الإعداد: <span className="text-slate-200">{STATUS_LABELS[primary.status] ?? primary.status}</span></span>
                <span>ثقة الإعداد: <span className={CONFIDENCE_TONE[primary.confidence] ?? "text-slate-400"}>{primary.confidence}</span></span>
                <span>آخر تحقّق: <span className="text-slate-200">لم يحدث بعد</span></span>
              </div>
              <p className="text-slate-500 mt-1">
                ATR({primary.params.atrPeriod}) · ADX({primary.params.adxPeriod}) · EMA({primary.params.emaFast}/{primary.params.emaMedium}/{primary.params.emaSlow})
              </p>
              <p className="text-[10px] text-slate-600 mt-1">خطوات الاختيار: {primary.selectionSteps.join(" ← ")}</p>
            </div>
          )}

          {decision && decision.configTrace.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] text-slate-400">
                <thead>
                  <tr className="text-slate-500 border-b border-border/40">
                    <th className="text-right py-1 pr-2">الفريم</th>
                    <th className="text-right py-1 pr-2">الاستراتيجية</th>
                    <th className="text-right py-1 pr-2">الحالة</th>
                    <th className="text-right py-1 pr-2">الثقة</th>
                  </tr>
                </thead>
                <tbody>
                  {decision.configTrace.map((c) => (
                    <tr key={c.timeframe} className="border-b border-border/20">
                      <td className="py-1 pr-2 text-slate-300">{c.timeframe}</td>
                      <td className="py-1 pr-2">{c.strategyLabel}</td>
                      <td className="py-1 pr-2">{STATUS_LABELS[c.status] ?? c.status}</td>
                      <td className={`py-1 pr-2 ${CONFIDENCE_TONE[c.confidence] ?? ""}`}>{c.confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!ran && (
            <button
              onClick={run}
              disabled={loading}
              className="flex items-center gap-2 text-xs px-3 py-2 rounded-md border border-accent/50 bg-accent/10 text-accent-glow hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Microscope className="h-3.5 w-3.5" />}
              {loading ? "جاري التحليل…" : "افحص كفاية الأدلة (Data Sufficiency)"}
            </button>
          )}

          {error && (
            <div className="flex items-start gap-2 text-xs text-amber-300/90 bg-amber-900/10 border border-amber-700/30 rounded-lg p-2.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {sufficiency && (
            <div className="glass-panel p-3 border border-border/60 text-xs space-y-1.5">
              <p className="text-slate-300 font-semibold">كفاية الأدلة (من صفقات الاختبار التاريخي الفعلية)</p>
              <p className="text-slate-400">
                المستوى: <span className="font-semibold">{TIER_LABELS[sufficiency.tier] ?? sufficiency.tier}</span> ·
                عدد الصفقات: {sufficiency.tradeCount} · أنظمة سوق مختلفة مُمثَّلة: {sufficiency.regimesRepresented} · المدة: {sufficiency.daySpan} يوم
              </p>
              {sufficiency.notes.length > 0 && (
                <ul className="text-slate-500 list-disc pr-4 space-y-0.5">
                  {sufficiency.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {bootstrap && (
            <div className="glass-panel p-3 border border-border/60 text-xs space-y-1.5">
              <p className="text-slate-300 font-semibold">فاصل ثقة Bootstrap (داخل العيّنة، {bootstrap.iterations} إعادة تكرار)</p>
              <p className="text-slate-400">
                متوسط Expectancy: <span className="font-mono">{bootstrap.expectancyMean}R</span> · فاصل الثقة 95%:{" "}
                <span className="font-mono">
                  [{bootstrap.expectancyCI[0]}R ، {bootstrap.expectancyCI[1]}R]
                </span>
              </p>
              {bootstrap.profitFactorMean != null && (
                <p className="text-slate-400">
                  متوسط Profit Factor: <span className="font-mono">{bootstrap.profitFactorMean}</span> · فاصل الثقة 95%:{" "}
                  <span className="font-mono">
                    [{bootstrap.profitFactorCI[0] ?? "—"} ، {bootstrap.profitFactorCI[1] ?? "—"}]
                  </span>
                </p>
              )}
              <p className="text-[10px] text-slate-600">
                فاصل واسع = عدم يقين حقيقي بسبب عيّنة صغيرة، مش خطأ بالحساب — هذا بالضبط الهدف من الأداة: تُظهر عدم اليقين بدل ما تخفيه.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
