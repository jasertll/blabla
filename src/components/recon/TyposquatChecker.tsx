"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Copy as CopyIcon, Loader2, AlertTriangle, Pin } from "lucide-react";
import type { TyposquatResult } from "@/app/api/osint/typosquat/route";
import { useInvestigation } from "@/contexts/InvestigationContext";

const CATEGORY_LABEL: Record<string, string> = {
  omission: "Omission",
  duplication: "Duplication",
  transposition: "Transposition",
  homoglyph: "Homoglyph",
  hyphenation: "Hyphenation",
  "tld-swap": "TLD swap",
  "combo-squat": "Combo-squat",
};

export default function TyposquatChecker() {
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TyposquatResult | null>(null);
  const { incrementSessionCount, mergeGraph, setToolAlert, addTimelineEvent } = useInvestigation();

  async function scan() {
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/osint/typosquat?target=${encodeURIComponent(target.trim())}`);
      const json: TyposquatResult = await res.json();
      if (!res.ok) {
        setError((json as any).error ?? `HTTP ${res.status}`);
        return;
      }
      setData(json);
      incrementSessionCount();
      addTimelineEvent({ tool: "recon", label: "Typosquat scan", detail: `${target.trim()} — ${json.registeredCount} registered lookalikes` });
      setToolAlert("recon", json.registeredCount > 0);
    } catch {
      setError("Network error reaching the typosquat lookup API.");
    } finally {
      setLoading(false);
    }
  }

  function pinToGraph() {
    if (!data) return;
    const registered = data.candidates.filter((c) => c.registered === true);
    if (registered.length === 0) return;
    const rootId = `domain:${data.target}`;
    mergeGraph(
      [
        { id: rootId, type: "domain", label: data.target },
        ...registered.map((c) => ({ id: `domain:${c.domain}`, type: "domain" as const, label: c.domain, detail: `Possible lookalike (${CATEGORY_LABEL[c.category]})` })),
      ],
      registered.map((c) => ({ id: `${rootId}->domain:${c.domain}`, source: rootId, target: `domain:${c.domain}`, relationship: "RELATED_TO" as const }))
    );
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <CopyIcon className="h-3.5 w-3.5 text-accent" /> Typosquat / Lookalike Domain Generator
      </p>
      <p className="text-[11px] text-slate-500">
        Generates common lookalike permutations of a domain (character swaps, homoglyphs, hyphens,
        alternate TLDs, brand-squat prefixes) and checks each one via keyless DNS to see which are
        actually registered — the classic brand-protection / phishing-infrastructure check.
      </p>

      <div className="flex gap-2">
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && scan()}
          placeholder="e.g. example.com"
          dir="ltr"
          className="flex-1 bg-panel/60 border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
        />
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={scan}
          disabled={loading || !target.trim()}
          className="text-xs px-3 py-1.5 rounded-md bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Generate & Check"}
        </motion.button>
      </div>
      {loading && <p className="text-[11px] text-slate-500">Checking ~40 candidates via DNS — this takes a few seconds…</p>}
      {error && <p className="text-xs text-red-300">{error}</p>}

      {data && !loading && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          <div className="flex items-center justify-between">
            <p className={`text-xs flex items-center gap-1.5 ${data.registeredCount > 0 ? "text-amber-300" : "text-emerald-300"}`}>
              {data.registeredCount > 0 && <AlertTriangle className="h-3.5 w-3.5" />}
              {data.registeredCount} of {data.checkedCount} lookalike{data.checkedCount === 1 ? "" : "s"} registered
            </p>
            {data.registeredCount > 0 && (
              <button
                onClick={pinToGraph}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
              >
                <Pin className="h-3 w-3" /> Pin to Graph
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-[#0d0a18] p-2 space-y-0.5">
            {data.candidates.map((c) => (
              <div key={c.domain} className="flex items-center justify-between gap-2 text-xs font-mono py-0.5">
                <span className={c.registered === true ? "text-amber-300" : c.registered === false ? "text-slate-400" : "text-slate-600"}>
                  {c.domain}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-[9px] uppercase text-slate-600">{CATEGORY_LABEL[c.category]}</span>
                  <span className={`text-[10px] font-sans ${c.registered === true ? "text-amber-300" : c.registered === false ? "text-slate-600" : "text-slate-700"}`}>
                    {c.registered === true ? "registered" : c.registered === false ? "available" : "unknown"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
