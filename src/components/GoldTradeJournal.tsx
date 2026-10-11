"use client";

import { useEffect, useState } from "react";
import { NotebookPen, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { GoldDecisionOutput } from "@/lib/gold/types";
import {
  type JournalEntry,
  type JournalOutcome,
  loadJournal,
  addJournalEntry,
  updateJournalEntry,
  removeJournalEntry,
  computeJournalStats,
  rMultipleFor,
} from "@/lib/gold/journalStorage";

const OUTCOME_LABELS: Record<JournalOutcome, string> = {
  open: "لسا مفتوحة",
  tp1: "TP1",
  tp2: "TP2",
  tp3: "TP3",
  sl: "وقف الخسارة",
  breakeven: "تعادل",
  manual: "إغلاق يدوي",
};

export default function GoldTradeJournal({ decision }: { decision: GoldDecisionOutput | null }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setEntries(loadJournal());
    setHydrated(true);
  }, []);

  function logCurrentDecision() {
    if (!decision || decision.decision === "wait") return;
    const next = addJournalEntry({
      direction: decision.decision,
      primaryTimeframe: decision.primaryTimeframe,
      entryPrice: decision.price,
      stopLoss: decision.stopLoss,
      tp1: decision.tp1,
      tp2: decision.tp2,
      tp3: decision.tp3,
      signalScore: decision.signalScore,
      quality: decision.quality,
    });
    setEntries(next);
    setOpen(true);
  }

  function setOutcome(id: string, outcome: JournalOutcome) {
    setEntries(updateJournalEntry(id, { outcome }));
  }

  function setManualExit(id: string, value: number) {
    setEntries(updateJournalEntry(id, { outcome: "manual", manualExitPrice: value }));
  }

  function remove(id: string) {
    setEntries(removeJournalEntry(id));
  }

  const stats = computeJournalStats(entries);
  const canLogNow = decision != null && decision.decision !== "wait";

  return (
    <div className="glass-panel p-4 space-y-3">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center justify-between w-full">
        <span className="flex items-center gap-2 text-sm font-display font-semibold text-slate-100">
          <NotebookPen className="h-4 w-4 text-accent" />
          سجل قراراتي {hydrated && entries.length > 0 ? `(${entries.length})` : ""}
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
      </button>

      {open && (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            سجل شخصي محفوظ بمتصفحك فقط (localStorage) — مش بسيرفرنا، وما بينتقل معك لجهاز أو متصفح ثاني. هاد مختلف عن الاختبار التاريخي (Backtest): هون
            بنسجل بس القرارات يلي شفتها فعلاً أنت، وبتحدد إنت شخصياً شو صار فيها — يعني نسبة النجاح هون تعكس استخدامك الحقيقي، مش محاكاة تاريخية.
          </p>

          <button
            onClick={logCurrentDecision}
            disabled={!canLogNow}
            className={`text-xs font-semibold px-3 py-2 rounded-md border transition-colors ${
              canLogNow ? "bg-accent/20 border-accent/50 text-accent-glow hover:bg-accent/30" : "bg-surface-elevated border-border/60 text-slate-600 cursor-not-allowed"
            }`}
          >
            {canLogNow ? `+ سجّل صفقة ${decision!.decision === "buy" ? "الشراء" : "البيع"} الحالية` : "سجّل صفقة (متاح بس لما يطلع قرار شراء/بيع)"}
          </button>

          {stats.resolved > 0 && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="glass-panel py-2">
                <p className="text-[10px] text-slate-500">نسبة النجاح</p>
                <p className="text-sm font-mono font-bold text-accent-glow">{stats.winRatePct}%</p>
              </div>
              <div className="glass-panel py-2">
                <p className="text-[10px] text-slate-500">متوسط R</p>
                <p className={`text-sm font-mono font-bold ${stats.avgR != null && stats.avgR > 0 ? "text-emerald-300" : "text-red-300"}`}>
                  {stats.avgR != null ? stats.avgR.toFixed(2) : "—"}
                </p>
              </div>
              <div className="glass-panel py-2">
                <p className="text-[10px] text-slate-500">مغلقة / مفتوحة</p>
                <p className="text-sm font-mono font-bold text-slate-300">
                  {stats.resolved} / {stats.open}
                </p>
              </div>
            </div>
          )}

          {entries.length === 0 ? (
            <p className="text-xs text-slate-600">ما سجّلت أي صفقة لسا.</p>
          ) : (
            <ul className="space-y-2">
              {entries.map((e) => {
                const r = rMultipleFor(e);
                return (
                  <li key={e.id} className="glass-panel p-2.5 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className={`font-semibold ${e.direction === "buy" ? "text-emerald-300" : "text-red-300"}`}>
                        {e.direction === "buy" ? "شراء" : "بيع"} · <bdi>{e.primaryTimeframe}</bdi> · {new Date(e.loggedAt).toLocaleString("ar-EG", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <button onClick={() => remove(e.id)} className="text-slate-600 hover:text-red-400" title="احذف">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="text-slate-500">
                      دخول {e.entryPrice?.toFixed(2) ?? "—"} · SL {e.stopLoss?.toFixed(2) ?? "—"} · TP1 {e.tp1?.toFixed(2) ?? "—"}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(["tp1", "tp2", "tp3", "sl", "breakeven"] as JournalOutcome[]).map((o) => (
                        <button
                          key={o}
                          onClick={() => setOutcome(e.id, o)}
                          className={`text-[10px] px-2 py-1 rounded border ${
                            e.outcome === o ? "bg-accent/25 border-accent/60 text-accent-glow" : "border-border/60 text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          {OUTCOME_LABELS[o]}
                        </button>
                      ))}
                      <input
                        type="number"
                        placeholder="إغلاق يدوي بسعر..."
                        defaultValue={e.manualExitPrice ?? undefined}
                        onBlur={(ev) => {
                          const v = Number(ev.target.value);
                          if (ev.target.value && !isNaN(v)) setManualExit(e.id, v);
                        }}
                        className="w-28 bg-surface-elevated border border-border/60 rounded px-1.5 py-1 text-[10px] text-slate-300 font-mono"
                      />
                    </div>
                    {e.outcome !== "open" && (
                      <p className="text-[11px] text-slate-500">
                        النتيجة: <span className="text-slate-300">{OUTCOME_LABELS[e.outcome]}</span>
                        {r != null && <span className={r > 0 ? "text-emerald-300" : "text-red-300"}> ({r > 0 ? "+" : ""}{r}R)</span>}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
