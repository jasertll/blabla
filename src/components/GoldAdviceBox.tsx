"use client";

import { Compass, Gauge } from "lucide-react";
import type { GoldDecisionOutput } from "@/lib/gold/types";

/**
 * Two things live in this one panel:
 *
 * 1. The RSI/MACD/volume readout — shown on EVERY check, buy/sell or
 *    wait, with an explicit agree/disagree badge against whichever
 *    direction is live (the fired decision if there is one, otherwise
 *    the raw directionEstimate lean). This is what decision.ts actually
 *    weighed into signalScore — showing it only in the wait case would
 *    make it look like these were ignored when a trade does fire, which
 *    isn't true.
 * 2. The consolidated "what am I waiting for" guidance (entryTimeWindow,
 *    the full whyWait list, recommendedTimeframe) — this part only
 *    applies when there's actually a wait to explain, so it's gated to
 *    decision === "wait" with no active news blackout (which already has
 *    its own explicit box elsewhere).
 */
export default function GoldAdviceBox({ decision }: { decision: GoldDecisionOutput }) {
  const regime = decision.regime;
  const isWaitAdvice = decision.decision === "wait" && !decision.newsBlackoutReason;
  if (!regime && !isWaitAdvice) return null;

  const liveDirection: "buy" | "sell" | null =
    decision.decision !== "wait"
      ? decision.decision
      : decision.directionEstimate.direction === "bullish"
      ? "buy"
      : decision.directionEstimate.direction === "bearish"
      ? "sell"
      : null;

  const rsi = regime?.rsi ?? null;
  const macd = regime?.macd ?? null;
  const macdBullish = macd != null ? macd.histogram > 0 : null;
  const macdAgrees =
    liveDirection != null && macdBullish != null ? (liveDirection === "buy" && macdBullish) || (liveDirection === "sell" && !macdBullish) : null;

  const rsiTone = rsi == null ? "text-slate-600" : rsi >= 70 ? "text-red-300" : rsi <= 30 ? "text-emerald-300" : "text-slate-300";
  const macdTone = macd == null ? "text-slate-600" : macd.histogram > 0 ? "text-emerald-300" : "text-red-300";

  return (
    <div className="glass-panel p-4 border-2 border-accent/40 space-y-3">
      <div className="flex items-center gap-2">
        {isWaitAdvice ? <Compass className="h-4 w-4 text-accent" /> : <Gauge className="h-4 w-4 text-accent" />}
        <h3 className="text-sm font-display font-bold text-accent-glow">{isWaitAdvice ? "🧭 نصيحة" : "📊 مؤشرات التأكيد"}</h3>
      </div>

      {regime && (
        <div>
          <p className="text-[11px] text-slate-500 mb-1.5">
            المؤشرات المستخدمة فعلياً بالتحليل (فريم <bdi>{decision.primaryTimeframe}</bdi>)
            {macdAgrees != null && (
              <span className={macdAgrees ? "text-emerald-300" : "text-amber-300"}> — {macdAgrees ? "MACD يؤكد الاتجاه" : "MACD ما أكد الاتجاه بالكامل"}</span>
            )}
          </p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="glass-panel py-2">
              <p className="text-[10px] text-slate-500">RSI</p>
              <p className={`text-sm font-mono font-bold ${rsiTone}`}>{rsi != null ? rsi.toFixed(0) : "—"}</p>
            </div>
            <div className="glass-panel py-2">
              <p className="text-[10px] text-slate-500">MACD Hist.</p>
              <p className={`text-sm font-mono font-bold ${macdTone}`}>{macd != null ? macd.histogram.toFixed(2) : "—"}</p>
            </div>
            <div className="glass-panel py-2">
              <p className="text-[10px] text-slate-500">الفوليوم</p>
              <p className="text-sm font-mono font-bold text-slate-300">
                {regime.volume?.available && regime.volume.relativeToAvg != null ? `${regime.volume.relativeToAvg}×` : "غير متوفر"}
              </p>
            </div>
          </div>
        </div>
      )}

      {isWaitAdvice && (
        <>
          {decision.entryTimeWindow && (
            <p className="text-sm font-semibold text-amber-200 bg-amber-950/20 border border-amber-700/30 rounded-lg px-3 py-2 leading-relaxed">
              {decision.entryTimeWindow}
            </p>
          )}

          {decision.whyWait.length > 0 && (
            <div>
              <p className="text-[11px] text-slate-500 mb-1">كل الأسباب اللي مانعة الدخول حالياً:</p>
              <ul className="text-xs text-slate-400 space-y-1 list-disc pr-4">
                {decision.whyWait.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          {decision.recommendedTimeframe && (
            <p className="text-xs text-slate-400">
              أنسب فريم للتأكيد الآن: <span className="text-accent-glow font-semibold">{decision.recommendedTimeframe}</span> — عليه حالياً أوضح كسر
              هيكلي/اتجاه متوافق مع الاتجاه المتوقع.
            </p>
          )}
        </>
      )}
    </div>
  );
}
