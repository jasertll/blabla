"use client";

import { useEffect, useState } from "react";
import { Calculator } from "lucide-react";

const STORAGE_KEY = "jaser:gold:positionSizer:v1";

type SavedInputs = { balance: number; riskPct: number };

function loadSaved(): SavedInputs {
  if (typeof window === "undefined") return { balance: 1000, riskPct: 1 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { balance: 1000, riskPct: 1 };
    const parsed = JSON.parse(raw);
    return {
      balance: typeof parsed.balance === "number" && parsed.balance > 0 ? parsed.balance : 1000,
      riskPct: typeof parsed.riskPct === "number" && parsed.riskPct > 0 ? parsed.riskPct : 1,
    };
  } catch {
    return { balance: 1000, riskPct: 1 };
  }
}

/**
 * Given the decision's own price/stopLoss, computes how many ounces of
 * XAU/USD to trade so a stop-out loses exactly `riskPct`% of `balance` —
 * not a lot-size guess, real arithmetic off the actual stop distance.
 * Reported in ounces first (broker-agnostic) since standard/mini/micro
 * lot sizing (100/10/1 oz) is a common convention, not a universal one —
 * disclosed rather than assumed silently.
 */
export default function GoldPositionSizer({ price, stopLoss }: { price: number | null; stopLoss: number | null }) {
  const [balance, setBalance] = useState(1000);
  const [riskPct, setRiskPct] = useState(1);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = loadSaved();
    setBalance(saved.balance);
    setRiskPct(saved.riskPct);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ balance, riskPct }));
  }, [balance, riskPct, hydrated]);

  const stopDistance = price != null && stopLoss != null ? Math.abs(price - stopLoss) : null;
  const riskAmount = balance > 0 && riskPct > 0 ? (balance * riskPct) / 100 : 0;
  const ounces = stopDistance != null && stopDistance > 0 ? riskAmount / stopDistance : null;

  return (
    <div className="glass-panel p-3 border border-border/60">
      <div className="flex items-center gap-2 mb-2">
        <Calculator className="h-3.5 w-3.5 text-accent" />
        <p className="text-xs text-slate-300 font-semibold">حاسبة حجم الصفقة</p>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <label className="text-[10px] text-slate-500">
          رصيد الحساب ($)
          <input
            type="number"
            min={0}
            value={balance}
            onChange={(e) => setBalance(Math.max(0, Number(e.target.value) || 0))}
            className="mt-1 w-full bg-surface-elevated border border-border/60 rounded-md px-2 py-1 text-xs text-slate-200 font-mono"
          />
        </label>
        <label className="text-[10px] text-slate-500">
          نسبة المخاطرة بالصفقة (%)
          <input
            type="number"
            min={0}
            step={0.1}
            value={riskPct}
            onChange={(e) => setRiskPct(Math.max(0, Number(e.target.value) || 0))}
            className="mt-1 w-full bg-surface-elevated border border-border/60 rounded-md px-2 py-1 text-xs text-slate-200 font-mono"
          />
        </label>
      </div>

      {stopDistance == null ? (
        <p className="text-[11px] text-slate-600">بحتاج سعر ووقف خسارة فعّالين (لما يطلع اتجاه واضح) عشان أحسبلك الحجم.</p>
      ) : ounces == null || !isFinite(ounces) ? (
        <p className="text-[11px] text-slate-600">وقف الخسارة طابق السعر الحالي — ما بقدر أحسب مسافة مخاطرة.</p>
      ) : (
        <div className="space-y-1">
          <p className="text-[11px] text-slate-500">
            مخاطرة الصفقة: <span className="text-slate-300 font-mono">${riskAmount.toFixed(2)}</span> · مسافة الوقف:{" "}
            <span className="text-slate-300 font-mono">${stopDistance.toFixed(2)}</span>
          </p>
          <p className="text-sm font-display font-bold text-accent-glow">{ounces.toFixed(2)} أونصة ذهب</p>
          <p className="text-[10px] text-slate-600">
            يعادل تقريباً: {(ounces / 100).toFixed(2)} لوت قياسي (standard) · {(ounces / 10).toFixed(2)} لوت مصغّر (mini) · {ounces.toFixed(2)} لوت مايكرو (micro)
          </p>
          <p className="text-[10px] text-slate-600">
            الافتراض: لوت قياسي = 100 أونصة، مصغّر = 10، مايكرو = 1 — هاي تقريباً القياسي عند أغلب الوسطاء، بس تأكد من تعريف الوسيط عندك تحديداً قبل التنفيذ.
          </p>
        </div>
      )}
    </div>
  );
}
