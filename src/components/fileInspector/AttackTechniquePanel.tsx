"use client";

import { useEffect, useState } from "react";
import { Crosshair, Tag, TagIcon } from "lucide-react";
import type { Verdict } from "@/lib/fileAnalysis";
import { resolveAttackTechniques } from "@/lib/attackMapping";
import { isTechniqueTagged, setTechniqueTagged } from "@/lib/attackTagging";
import { useInvestigation } from "@/contexts/InvestigationContext";

// Real evidence → real technique, both ways: every row here traces back
// to a specific finding above (never asserted on its own), and "Tag"
// writes to the exact same localStorage store the ATT&CK Technique
// Matrix tool reads from, so tagging here actually shows up in that
// tool's coverage heatmap — a genuine cross-tool connection, not just a
// label that says "MITRE ATT&CK" for effect.
export default function AttackTechniquePanel({ verdicts }: { verdicts: Verdict[] }) {
  const matches = resolveAttackTechniques(verdicts);
  const [tagged, setTagged] = useState<Record<string, boolean>>({});
  const { addTimelineEvent } = useInvestigation();

  useEffect(() => {
    const state: Record<string, boolean> = {};
    for (const m of matches) state[m.technique.id] = isTechniqueTagged(m.technique.id);
    setTagged(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdicts]);

  if (matches.length === 0) {
    return (
      <div className="rounded-lg border border-border p-6 text-center text-xs text-slate-500">
        No findings above map to a known ATT&CK technique — either this file is clean, or its indicators are outside what this app's mapping table covers.
      </div>
    );
  }

  function toggle(id: string, name: string) {
    const next = !tagged[id];
    setTechniqueTagged(id, next);
    setTagged((prev) => ({ ...prev, [id]: next }));
    if (next) addTimelineEvent({ tool: "file", label: "ATT&CK technique tagged from File Inspector", detail: `${id} — ${name}` });
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[11px] text-slate-400 mb-2 flex items-center gap-1.5">
        <Crosshair className="h-3 w-3 text-accent" /> MITRE ATT&CK techniques matched from this file's real findings
      </p>
      <div className="space-y-2">
        {matches.map((m) => (
          <div key={m.technique.id} className="rounded-lg border border-border/70 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-slate-100 font-medium">
                  <span className="text-accent-glow font-mono">{m.technique.id}</span> — {m.technique.name}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">{m.technique.tactic}</p>
              </div>
              <button
                onClick={() => toggle(m.technique.id, m.technique.name)}
                className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border shrink-0 transition-colors ${
                  tagged[m.technique.id] ? "border-accent bg-accent/20 text-accent-glow" : "border-border text-slate-400 hover:border-accent/50"
                }`}
              >
                {tagged[m.technique.id] ? <TagIcon className="h-3 w-3" /> : <Tag className="h-3 w-3" />}
                {tagged[m.technique.id] ? "Tagged" : "Tag"}
              </button>
            </div>
            <p className="text-[10.5px] text-slate-400 mt-1.5">{m.technique.description}</p>
            <p className="text-[10px] text-slate-500 mt-1.5">
              <span className="text-slate-400">Evidence:</span> {m.triggeredBy.join("; ")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
