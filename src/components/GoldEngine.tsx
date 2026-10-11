"use client";

import { useCallback, useEffect, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Hourglass,
  RefreshCw,
  KeyRound,
  AlertTriangle,
  Activity,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";
import type { GoldDecisionOutput } from "@/lib/gold/types";
import GoldBacktestPanel from "@/components/GoldBacktestPanel";
import GoldEntryCheck, { fmtAge } from "@/components/GoldEntryCheck";
import GoldChart from "@/components/GoldChart";
import GoldNewsHeadlines from "@/components/GoldNewsHeadlines";
import GoldConfigDiagnostics from "@/components/GoldConfigDiagnostics";
import GoldAdviceBox from "@/components/GoldAdviceBox";
import GoldPositionSizer from "@/components/GoldPositionSizer";
import GoldTradeJournal from "@/components/GoldTradeJournal";
import GoldAlerts from "@/components/GoldAlerts";

const DECISION_REFRESH_MS = 45_000; // matches the server-side candle cache TTL (60s, see app/api/gold/decision/route.ts) closely enough that most polls land as cache hits, with the remainder forcing a real refresh roughly once a minute — tighter than before now that the TTL itself came down
const PRICE_REFRESH_MS = 8_000; // matches the server's quote cache TTL (8s) — safe to run this fast because the primary quote source (gold-api.com) is keyless with no documented rate limit

const REGIME_LABELS: Record<string, string> = {
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

const NEWS_RISK_LABELS: Record<string, string> = {
  low: "منخفض",
  medium: "متوسط — خبر قادم",
  high: "مرتفع — ضمن نافذة الحظر",
  extreme: "شديد — FOMC ضمن النافذة",
  unavailable: "غير معروف",
};

const NEWS_RISK_TONE: Record<string, string> = {
  low: "text-emerald-300",
  medium: "text-amber-300",
  high: "text-orange-300",
  extreme: "text-red-300",
  unavailable: "text-slate-400",
};

const ENTRY_QUALITY_LABELS: Record<string, string> = {
  EXCELLENT: "ممتازة",
  GOOD: "جيدة",
  FAIR: "مقبولة",
  POOR: "ضعيفة — السعر مبتعد عن المنطقة المثالية",
};
const ENTRY_QUALITY_TONE: Record<string, string> = {
  EXCELLENT: "text-emerald-300",
  GOOD: "text-emerald-300",
  FAIR: "text-amber-300",
  POOR: "text-red-300",
};
const SL_QUALITY_LABELS: Record<string, string> = {
  TIGHT: "ضيّق",
  NORMAL: "طبيعي",
  WIDE: "واسع",
  EXTREME: "واسع جداً — غير مبرَّر",
};
const SL_QUALITY_TONE: Record<string, string> = {
  TIGHT: "text-amber-300",
  NORMAL: "text-emerald-300",
  WIDE: "text-amber-300",
  EXTREME: "text-red-300",
};

const FEED_STATUS_LABELS: Record<string, string> = {
  LIVE: "🟢 LIVE",
  DELAYED: "🟡 DELAYED",
  STALE: "🔴 STALE",
  CONFLICTED: "🔴 CONFLICTED",
  UNAVAILABLE: "⚪ UNAVAILABLE",
};
const FEED_STATUS_TONE: Record<string, string> = {
  LIVE: "text-emerald-300 border-emerald-700/40 bg-emerald-900/10",
  DELAYED: "text-amber-300 border-amber-700/40 bg-amber-900/10",
  STALE: "text-red-300 border-red-700/40 bg-red-900/10",
  CONFLICTED: "text-red-300 border-red-700/40 bg-red-900/10",
  UNAVAILABLE: "text-slate-400 border-border",
};

const QUALITY_TONE: Record<string, string> = {
  "A+": "text-emerald-300 border-emerald-600/50 bg-emerald-900/20",
  A: "text-emerald-300 border-emerald-700/40 bg-emerald-900/10",
  B: "text-amber-300 border-amber-700/40 bg-amber-900/10",
  C: "text-orange-300 border-orange-700/40 bg-orange-900/10",
  NO_TRADE: "text-slate-400 border-border bg-surface-elevated",
};

function DecisionBadge({ decision }: { decision: GoldDecisionOutput["decision"] }) {
  if (decision === "buy") {
    return (
      <div className="flex items-center gap-2 text-emerald-300 bg-emerald-900/20 border border-emerald-600/40 rounded-xl px-4 py-3">
        <TrendingUp className="h-6 w-6" />
        <span className="font-display text-xl font-bold">🟢 شراء</span>
      </div>
    );
  }
  if (decision === "sell") {
    return (
      <div className="flex items-center gap-2 text-red-300 bg-red-900/20 border border-red-600/40 rounded-xl px-4 py-3">
        <TrendingDown className="h-6 w-6" />
        <span className="font-display text-xl font-bold">🔴 بيع</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-slate-300 bg-surface-elevated border border-border rounded-xl px-4 py-3">
      <Hourglass className="h-6 w-6" />
      <span className="font-display text-xl font-bold">⏳ انتظار</span>
    </div>
  );
}

function PriceLevel({ label, value, tone }: { label: string; value: number | null; tone: string }) {
  return (
    <div className="flex items-center justify-between text-sm border-b border-border/40 py-1.5">
      <span className="text-slate-500">{label}</span>
      <span className={`font-mono font-semibold ${tone}`}>{value != null ? value.toFixed(2) : "—"}</span>
    </div>
  );
}

const TIMEFRAME_OPTIONS = ["5M", "15M", "30M", "1H", "4H"] as const;

export default function GoldEngine() {
  const [data, setData] = useState<GoldDecisionOutput | null>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [livePriceAt, setLivePriceAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [showWhyWait, setShowWhyWait] = useState(true);
  const [primaryTf, setPrimaryTf] = useState<(typeof TIMEFRAME_OPTIONS)[number]>("15M");

  const load = useCallback(async (tf: string) => {
    try {
      const res = await fetch(`/api/gold/decision?tf=${tf}`, { cache: "no-store" });
      if (res.status === 429) {
        setError("تجاوزنا حد الطلبات المسموح — سيُعاد المحاولة تلقائياً بعد قليل.");
        return;
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch {
      setError("تعذّر الوصول لخدمة القرار.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPrice = useCallback(async () => {
    try {
      const res = await fetch("/api/gold/quote", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (json.status === "ok" && typeof json.price === "number") {
        setLivePrice(json.price);
        setLivePriceAt(Date.now());
      }
    } catch {
      // silent — this is a best-effort ticker layered on top of the full decision, which has its own error handling
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load(primaryTf);
    const id = setInterval(() => load(primaryTf), DECISION_REFRESH_MS);
    return () => clearInterval(id);
  }, [load, primaryTf]);

  useEffect(() => {
    loadPrice();
    const id = setInterval(loadPrice, PRICE_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadPrice]);

  const displayPrice = livePrice ?? data?.price ?? null;
  const missingTwelveData = data?.dataIssues.some((i) => i.includes("TWELVEDATA_API_KEY"));

  return (
    <div className="space-y-4">
      {missingTwelveData && (
        <div className="glass-panel p-4 border border-amber-700/40 bg-amber-900/10 space-y-2">
          <div className="flex items-center gap-2 text-amber-300">
            <KeyRound className="h-4 w-4" />
            <h3 className="font-display font-semibold text-sm">إعداد مطلوب لتفعيل محرك الذهب</h3>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            هذه الأداة تحتاج مفتاح API مجاني واحد فقط لأسعار وشموع XAU/USD اللحظية (بيانات عوائد السندات والدولار
            تُجلب تلقائياً من مصادر رسمية بدون أي مفتاح):
          </p>
          <ul className="text-xs text-slate-400 space-y-1 list-disc pr-4">
            <li>
              <code className="font-mono text-amber-300">TWELVEDATA_API_KEY</code> — سجّل مجاناً على twelvedata.com (المصدر الأساسي، مطلوب).
            </li>
            <li>
              <code className="font-mono text-amber-300">FINNHUB_API_KEY</code> — سجّل مجاناً على finnhub.io (مصدر احتياطي اختياري — يشتغل تلقائياً بس إذا TwelveData رفض طلب بسبب حد الطلبات؛ التطبيق يشتغل كامل بدونه).
            </li>
          </ul>
          <p className="text-[11px] text-slate-500">أضفهم لملف .env.local ثم أعد تشغيل السيرفر.</p>
        </div>
      )}

      <div className="glass-panel p-3 flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-400">الفريم الأساسي للقرار:</span>
        {TIMEFRAME_OPTIONS.map((tf) => (
          <button
            key={tf}
            onClick={() => setPrimaryTf(tf)}
            className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
              primaryTf === tf ? "bg-accent/20 border-accent/60 text-accent-glow font-semibold" : "border-border text-slate-400 hover:text-slate-200"
            }`}
          >
            {tf}
          </button>
        ))}
        <span className="text-[10px] text-slate-600">— كل فريم بيعطيك خطة دخول/خروج مختلفة مبنية على تقلّبه وهيكله الخاص</span>
      </div>

      <GoldEntryCheck
        primaryTf={primaryTf}
        onSwitchTimeframe={(tf) => {
          if ((TIMEFRAME_OPTIONS as readonly string[]).includes(tf)) setPrimaryTf(tf as (typeof TIMEFRAME_OPTIONS)[number]);
        }}
      />

      <div className="glass-panel p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Activity className="h-5 w-5 text-accent" />
            <div>
              <h2 className="font-display font-semibold text-sm text-slate-100">XAU/USD — محرك القرار</h2>
              <p className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
                {displayPrice != null ? (
                  <>
                    {livePriceAt && <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                    <span>السعر الحالي: ${displayPrice.toFixed(2)}</span>
                  </>
                ) : (
                  "بانتظار السعر…"
                )}
                {data?.regime && <span className="mr-2"> · حالة السوق: {REGIME_LABELS[data.regime.regime] ?? data.regime.regime}</span>}
              </p>
              {data?.priceAsOf != null && (
                <p className={`text-[10px] mt-0.5 ${Date.now() - data.priceAsOf > 90_000 ? "text-amber-400" : "text-slate-600"}`}>
                  السعر المستخدم بحساب القرار (${data.price?.toFixed(2)}) آخر تحديث فعلي له: قبل {fmtAge(Date.now() - data.priceAsOf)} — قارنه مع سعر منصتك قبل أي قرار.
                </p>
              )}
              {data?.sessions && data.sessions.length > 0 && (
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {data.sessions.map((s) => (
                    <span
                      key={s.session}
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        s.session === "overlap" && s.active
                          ? "text-amber-200 border-amber-500/60 bg-amber-900/20 font-semibold"
                          : s.active
                          ? "text-accent-glow border-accent/50 bg-accent/10"
                          : "text-slate-600 border-border/60"
                      }`}
                      title={s.high != null && s.low != null ? `${s.label}: ${s.low.toFixed(2)} – ${s.high.toFixed(2)}` : s.label}
                    >
                      {s.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center flex-wrap gap-2">
            <GoldAlerts decision={data} />
            {data?.marketState && (
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full border font-mono ${FEED_STATUS_TONE[data.marketState.feedStatus] ?? "text-slate-400 border-border"}`}
                title={`المصدر: ${data.marketState.source ?? "—"} · العمر: ${data.marketState.ageMs != null ? fmtAge(data.marketState.ageMs) : "—"} · زمن الاستجابة: ${
                  data.marketState.latencyMs != null ? `${data.marketState.latencyMs}ms` : "—"
                }`}
              >
                {FEED_STATUS_LABELS[data.marketState.feedStatus] ?? data.marketState.feedStatus}
              </span>
            )}
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full border ${
                data?.dataHealth === "healthy"
                  ? "text-emerald-300 border-emerald-700/40 bg-emerald-900/10"
                  : data?.dataHealth === "degraded"
                  ? "text-amber-300 border-amber-700/40 bg-amber-900/10"
                  : "text-red-300 border-red-700/40 bg-red-900/10"
              }`}
            >
              {data?.dataHealth === "healthy" ? "🟢 البيانات سليمة" : data?.dataHealth === "degraded" ? "🟡 بيانات جزئية" : "🔴 تعذّر جلب البيانات"}
            </span>
            <button onClick={() => load(primaryTf)} disabled={loading} className="p-1.5 rounded-md border border-border text-slate-400 hover:text-slate-200 transition-colors">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {error && <p className="text-xs text-red-300">{error}</p>}

        {loading && !data && !error && (
          <div className="space-y-3" aria-live="polite" aria-label="جاري تحميل القرار">
            <div className="skeleton-block h-11 w-full" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="skeleton-block h-16" />
              <div className="skeleton-block h-16" />
              <div className="skeleton-block h-16" />
              <div className="skeleton-block h-16" />
            </div>
            <div className="skeleton-block h-40 w-full" />
          </div>
        )}

        {data && (
          <>
            <DecisionBadge decision={data.decision} />

            {data.decision !== "wait" && data.entryTimeWindow && (
              <p className="text-sm font-semibold rounded-lg px-3 py-2 border text-emerald-200 bg-emerald-950/30 border-emerald-700/30">{data.entryTimeWindow}</p>
            )}
            {data.decision !== "wait" && data.stopLoss != null && data.tp1 != null && (
              <p className="text-sm font-mono font-semibold text-emerald-200 bg-emerald-950/40 border border-emerald-700/30 rounded-lg px-3 py-2">
                سكّر عند وصول السعر لـ {data.tp1.toFixed(2)} (TP1) — وألغِ الصفقة فوراً لو رجع السعر لمس {data.stopLoss.toFixed(2)} (وقف الخسارة).
              </p>
            )}
            <GoldAdviceBox decision={data} />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="glass-panel p-3">
                <p className="text-[10px] text-slate-500 uppercase">Signal Score</p>
                <p className="text-lg font-display font-bold text-accent-glow">{data.signalScore}/100</p>
              </div>
              <div className={`glass-panel p-3 border ${QUALITY_TONE[data.quality]}`}>
                <p className="text-[10px] text-slate-500 uppercase">جودة الإعداد</p>
                <p className="text-lg font-display font-bold">{data.quality === "NO_TRADE" ? "لا صفقة" : data.quality}</p>
              </div>
              <div className="glass-panel p-3">
                <p className="text-[10px] text-slate-500 uppercase">الاحتمال التاريخي</p>
                <p className="text-sm text-slate-400">غير متوفر بعد (Baseline)</p>
              </div>
              <div className="glass-panel p-3">
                <p className="text-[10px] text-slate-500 uppercase">خطر الأخبار</p>
                <p className={`text-sm font-semibold ${NEWS_RISK_TONE[data.newsRisk]}`}>{NEWS_RISK_LABELS[data.newsRisk]}</p>
                {data.nextNewsEvent && (
                  <p className="text-[10px] text-slate-600 mt-0.5">
                    {data.nextNewsEvent.name} · خلال {data.nextNewsEvent.minutesUntil} دقيقة
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="glass-panel p-3">
                <p className="text-[10px] text-slate-500 uppercase mb-1">تقدير اتجاه السوق (منفصل عن قرار الدخول)</p>
                <p
                  className={`text-sm font-display font-bold ${
                    data.directionEstimate.direction === "bullish"
                      ? "text-emerald-300"
                      : data.directionEstimate.direction === "bearish"
                      ? "text-red-300"
                      : "text-slate-400"
                  }`}
                >
                  {data.directionEstimate.direction === "bullish" ? "صاعد" : data.directionEstimate.direction === "bearish" ? "هابط" : "محايد"}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {data.directionEstimate.bullVotes} من {data.directionEstimate.totalFrames} فريمات مالت صاعد · {data.directionEstimate.bearVotes} من{" "}
                  {data.directionEstimate.totalFrames} مالت هابط
                  <span className="text-slate-600"> (والباقي محايد) — مش نسبة احتمال ولا إلها نقيض</span>
                </p>
                <p className="text-[10px] text-slate-600 mt-0.5">{data.directionEstimate.basis}</p>
              </div>
              {data.entryQuality && (
                <div className="glass-panel p-3">
                  <p className="text-[10px] text-slate-500 uppercase mb-1">جودة موقع الدخول</p>
                  <p className={`text-sm font-display font-bold ${ENTRY_QUALITY_TONE[data.entryQuality]}`}>{ENTRY_QUALITY_LABELS[data.entryQuality]}</p>
                </div>
              )}
              {data.slQuality && (
                <div className="glass-panel p-3">
                  <p className="text-[10px] text-slate-500 uppercase mb-1">جودة وقف الخسارة</p>
                  <p className={`text-sm font-display font-bold ${SL_QUALITY_TONE[data.slQuality]}`}>{SL_QUALITY_LABELS[data.slQuality]}</p>
                </div>
              )}
            </div>

            {data.newsBlackoutReason && (
              <div className="flex items-start gap-2 text-xs text-red-300/90 bg-red-900/15 border border-red-700/40 rounded-lg p-2.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {data.newsBlackoutReason}
              </div>
            )}

            <GoldChart decision={data} primaryTf={primaryTf} />

            {data.entryZone != null && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="glass-panel p-3">
                  <p className="text-xs text-slate-500 mb-2">{data.decision !== "wait" ? "منطقة الدخول والوقت" : "منطقة الدخول المثالية (انتظر الوصول إليها)"}</p>
                  <p className="text-xs text-slate-400 font-mono mt-1">{data.entryZone[0].toFixed(2)} – {data.entryZone[1].toFixed(2)}</p>
                  <p className="text-[11px] text-slate-500 mt-2">⏱ {data.entryTimeWindow ?? "—"}</p>
                </div>
                <div className="glass-panel p-3">
                  <p className="text-xs text-slate-500 mb-2">وقف الخسارة والأهداف</p>
                  <PriceLevel label="وقف الخسارة (SL)" value={data.stopLoss} tone="text-red-300" />
                  <PriceLevel label="TP1" value={data.tp1} tone="text-emerald-300" />
                  <PriceLevel label="TP2" value={data.tp2} tone="text-emerald-300" />
                  <PriceLevel label="TP3" value={data.tp3} tone="text-emerald-300" />
                  {data.riskRewardTp1 != null && <p className="text-[11px] text-slate-500 mt-1">R:R حتى TP1 ≈ 1:{data.riskRewardTp1}</p>}
                </div>
              </div>
            )}

            {data.liquidity && (data.liquidity.nearestAbove || data.liquidity.nearestBelow) && (
              <div className="glass-panel p-3 border border-border/60">
                <p className="text-xs text-slate-500 mb-2">أقرب مستويات السيولة (تشمل الأرقام المدوّرة النفسية)</p>
                <div className="grid grid-cols-2 gap-3">
                  {data.liquidity.nearestAbove && (
                    <div>
                      <p className="text-[10px] text-slate-500">أقرب مستوى فوق السعر</p>
                      <p className="text-sm font-mono font-bold text-emerald-300">{data.liquidity.nearestAbove.price.toFixed(2)}</p>
                      <p className="text-[10px] text-slate-600">{data.liquidity.nearestAbove.label}</p>
                    </div>
                  )}
                  {data.liquidity.nearestBelow && (
                    <div>
                      <p className="text-[10px] text-slate-500">أقرب مستوى تحت السعر</p>
                      <p className="text-sm font-mono font-bold text-red-300">{data.liquidity.nearestBelow.price.toFixed(2)}</p>
                      <p className="text-[10px] text-slate-600">{data.liquidity.nearestBelow.label}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {data.entryZone != null && <GoldPositionSizer price={data.price} stopLoss={data.stopLoss} />}

            {data.exitPlan.length > 0 && (
              <div className="glass-panel p-3 border border-emerald-700/30">
                <p className="text-xs text-slate-300 font-semibold mb-1.5">امتى أطلع؟ (خطة الخروج)</p>
                <ul className="text-xs text-slate-400 space-y-1.5 list-disc pr-4">
                  {data.exitPlan.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-start gap-2 text-[11px] text-slate-500 bg-surface-elevated border border-border/60 rounded-lg p-2.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <p>المدة المتوقعة: غير متوفرة — لا توجد بيانات تاريخية كافية بعد (النظام لم يخضع لاختبار Backtesting). الحالة: {data.configStatus === "BASELINE_NOT_VALIDATED" ? "إعدادات أساسية غير محقّقة إحصائياً (BASELINE — NOT YET VALIDATED)." : data.configStatus}</p>
            </div>

            {data.dataIssues.length > 0 && (
              <div className="flex items-start gap-2 text-[11px] text-amber-300/90 bg-amber-900/10 border border-amber-700/30 rounded-lg p-2.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <ul className="space-y-0.5">
                  {data.dataIssues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            <button onClick={() => setShowWhy((v) => !v)} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200">
              {showWhy ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              لماذا هذا القرار؟
            </button>
            {showWhy && (
              <ul className="text-xs text-slate-400 space-y-1 list-disc pr-4">
                {data.why.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}

            {data.whyWait.length > 0 && (
              <>
                <button onClick={() => setShowWhyWait((v) => !v)} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200">
                  {showWhyWait ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  لماذا لا أدخل الآن؟
                </button>
                {showWhyWait && (
                  <ul className="text-xs text-slate-400 space-y-1 list-disc pr-4">
                    {data.whyWait.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {data.alternativeScenario && (
              <div className="glass-panel p-3 border border-border/60">
                <p className="text-xs text-slate-300 font-semibold mb-1.5">
                  إذا لم يتحقق السيناريو الحالي: سيناريو {data.alternativeScenario.direction === "buy" ? "🟢 الشراء" : "🔴 البيع"} البديل
                </p>
                <ul className="text-xs text-slate-500 space-y-1 list-disc pr-4">
                  {data.alternativeScenario.conditions.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-[10px] text-slate-600 leading-relaxed border-t border-border/40 pt-2">{data.disclaimer}</p>
          </>
        )}
      </div>

      <GoldNewsHeadlines />

      <GoldTradeJournal decision={data} />

      <GoldConfigDiagnostics decision={data} />

      <GoldBacktestPanel />
    </div>
  );
}
