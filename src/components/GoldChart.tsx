"use client";

import { useEffect, useState } from "react";
import { ComposedChart, Bar, XAxis, YAxis, ResponsiveContainer, ReferenceLine, ReferenceArea, Tooltip } from "recharts";
import { LineChart as ChartIcon, Loader2 } from "lucide-react";
import type { GoldDecisionOutput, Candle } from "@/lib/gold/types";

const REFRESH_MS = 60_000;

function CandleShape(props: any) {
  const { x, y, width, height, payload } = props;
  const { open, close, high, low } = payload as Candle;
  if (high === low || width <= 0) return null;
  const isUp = close >= open;
  const color = isUp ? "#34d399" : "#f87171";
  const priceToY = (price: number) => y + height * (1 - (price - low) / (high - low));
  const bodyTop = priceToY(Math.max(open, close));
  const bodyBottom = priceToY(Math.min(open, close));
  const bodyHeight = Math.max(1, bodyBottom - bodyTop);
  const centerX = x + width / 2;
  const bodyWidth = Math.max(1, width * 0.6);
  return (
    <g>
      <line x1={centerX} x2={centerX} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={centerX - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyHeight} fill={color} />
    </g>
  );
}

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null;
  const c: Candle = payload[0].payload;
  return (
    <div className="bg-surface-high border border-border rounded-md p-2 text-[11px] font-mono text-slate-300 space-y-0.5">
      <p>{new Date(c.time).toLocaleString("ar-EG", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</p>
      <p>O {c.open.toFixed(2)} · H {c.high.toFixed(2)}</p>
      <p>L {c.low.toFixed(2)} · C {c.close.toFixed(2)}</p>
    </div>
  );
}

const TF_TO_API: Record<string, string> = { "5M": "5min", "15M": "15min", "30M": "30min", "1H": "1h", "4H": "4h" };

export default function GoldChart({ decision, primaryTf = "15M" }: { decision: GoldDecisionOutput | null; primaryTf?: string }) {
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const apiTf = TF_TO_API[primaryTf] ?? "15min";

  const overlayValues: number[] = candles
    ? [
        decision?.stopLoss,
        decision?.tp1,
        decision?.tp2,
        decision?.tp3,
        decision?.entryZone?.[0],
        decision?.entryZone?.[1],
        decision?.price,
        ...(decision?.liquidity?.levels.map((l) => l.price) ?? []),
      ].filter((v): v is number => typeof v === "number")
    : [];

  const yDomain: [number | "auto", number | "auto"] =
    candles && candles.length > 0
      ? (() => {
          const candleMin = Math.min(...candles.map((c) => c.low));
          const candleMax = Math.max(...candles.map((c) => c.high));
          const allValues = [candleMin, candleMax, ...overlayValues];
          const min = Math.min(...allValues);
          const max = Math.max(...allValues);
          const pad = (max - min) * 0.05 || 1;
          return [min - pad, max + pad];
        })()
      : ["auto", "auto"];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    async function load() {
      try {
        const res = await fetch(`/api/gold/candles?tf=${apiTf}`, { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
          setCandles(null);
        } else {
          setCandles(json.candles);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("تعذّر جلب بيانات الرسم البياني.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [apiTf]);

  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ChartIcon className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-display font-semibold text-slate-100">الرسم البياني — <bdi>{primaryTf}</bdi></h3>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}
      </div>

      {error && !candles && <p className="text-xs text-amber-300/90">{error}</p>}

      {candles && candles.length > 0 && (
        <div className="h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={candles} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="time"
                tickFormatter={(t) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}
                tick={{ fontSize: 10, fill: "#64748b" }}
                minTickGap={40}
              />
              <YAxis
                domain={yDomain}
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickFormatter={(v: number) => v.toFixed(1)}
                width={55}
              />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey={(c: Candle) => [c.low, c.high]} shape={<CandleShape />} isAnimationActive={false} />

              {decision?.entryZone && (
                <ReferenceArea y1={decision.entryZone[0]} y2={decision.entryZone[1]} fill="#f59e0b" fillOpacity={0.12} strokeOpacity={0} />
              )}
              {decision?.stopLoss != null && (
                <ReferenceLine y={decision.stopLoss} stroke="#f87171" strokeDasharray="4 3" label={{ value: "SL", position: "insideTopLeft", fill: "#f87171", fontSize: 10 }} />
              )}
              {decision?.tp1 != null && (
                <ReferenceLine y={decision.tp1} stroke="#34d399" strokeDasharray="4 3" label={{ value: "TP1", position: "insideTopLeft", fill: "#34d399", fontSize: 10 }} />
              )}
              {decision?.tp2 != null && (
                <ReferenceLine y={decision.tp2} stroke="#6ee7b7" strokeDasharray="2 4" label={{ value: "TP2", position: "insideTopLeft", fill: "#6ee7b7", fontSize: 10 }} />
              )}
              {decision?.liquidity?.levels.map((lvl, i) => (
                <ReferenceLine
                  key={i}
                  y={lvl.price}
                  stroke="#fbbf24"
                  strokeOpacity={0.35}
                  strokeDasharray="1 3"
                  label={{ value: lvl.label, position: "insideBottomLeft", fill: "#fbbf24", fontSize: 9, fillOpacity: 0.7 }}
                />
              ))}
              {decision?.price != null && (
                <ReferenceLine y={decision.price} stroke="#f59e0b" strokeWidth={1.5} label={{ value: "الآن", position: "insideTopRight", fill: "#fbbf24", fontSize: 10 }} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="text-[10px] text-slate-600">
        الشموع = أسعار حقيقية من TwelveData · الخطوط المتقطعة = وقف الخسارة وأهداف الصفقة الحالية إن وُجدت · الخطوط الصفراء الخفيفة = مستويات سيولة (قمم/قيعان سابقة).
      </p>
    </div>
  );
}
