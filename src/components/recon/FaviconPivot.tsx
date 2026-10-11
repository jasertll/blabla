"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Sparkle, Loader2, ExternalLink, Pin } from "lucide-react";
import { ProviderBadge } from "@/components/ResolvedIpPanel";
import type { FaviconLookupResult } from "@/app/api/osint/favicon/route";
import { useInvestigation } from "@/contexts/InvestigationContext";

export default function FaviconPivot() {
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FaviconLookupResult | null>(null);
  const { incrementSessionCount, mergeGraph, addTimelineEvent } = useInvestigation();

  async function scan() {
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/osint/favicon?target=${encodeURIComponent(target.trim())}`);
      const json: FaviconLookupResult = await res.json();
      if (!res.ok) {
        setError((json as any).error ?? `HTTP ${res.status}`);
        return;
      }
      setData(json);
      incrementSessionCount();
      addTimelineEvent({ tool: "recon", label: "Favicon hash pivot", detail: target.trim() });
    } catch {
      setError("Network error reaching the favicon lookup API.");
    } finally {
      setLoading(false);
    }
  }

  function pinToGraph() {
    if (!data || data.favicon.status !== "ok") return;
    const id = `favicon:${data.favicon.data.hash}`;
    mergeGraph(
      [
        { id: `domain:${data.target}`, type: "domain", label: data.target },
        { id, type: "certificate", label: `Favicon hash ${data.favicon.data.hash}`, detail: "Shodan/Censys pivot" },
      ],
      [{ id: `domain:${data.target}->${id}`, source: `domain:${data.target}`, target: id, relationship: "RELATED_TO" }]
    );
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <Sparkle className="h-3.5 w-3.5 text-accent" /> Favicon Hash Pivot
      </p>
      <p className="text-[11px] text-slate-500">
        Hashes a site's favicon the same way Shodan and Censys index it (MurmurHash3 of the
        base64-encoded icon) — the same hash can then find every other host serving the identical
        icon, a real technique for pivoting to related attacker/organization infrastructure.
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
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Hash"}
        </motion.button>
      </div>

      {error && <p className="text-xs text-red-300">{error}</p>}

      {data && !loading && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          <ProviderBadge state={data.favicon} label="Favicon fetch" />
          {data.favicon.status === "ok" && (
            <div className="flex items-start gap-3">
              {data.favicon.data.previewDataUri && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.favicon.data.previewDataUri} alt="favicon" className="h-8 w-8 rounded border border-border shrink-0" />
              )}
              <div className="space-y-1.5 flex-1 min-w-0">
                <p className="text-xs font-mono text-accent-glow">hash: {data.favicon.data.hash}</p>
                <p className="text-[11px] text-slate-500 break-all">{data.favicon.data.faviconUrl}</p>
                <div className="flex flex-wrap gap-3">
                  <a href={data.favicon.data.shodanUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-accent-glow hover:underline">
                    <ExternalLink className="h-3 w-3" /> Pivot on Shodan
                  </a>
                  <a href={data.favicon.data.censysUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-accent-glow hover:underline">
                    <ExternalLink className="h-3 w-3" /> Pivot on Censys
                  </a>
                </div>
                <button
                  onClick={pinToGraph}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
                >
                  <Pin className="h-3 w-3" /> Pin to Intelligence Graph
                </button>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
