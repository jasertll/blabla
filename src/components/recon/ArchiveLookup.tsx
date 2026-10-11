"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Archive, Loader2, ExternalLink, Pin } from "lucide-react";
import { ProviderBadge } from "@/components/ResolvedIpPanel";
import type { ArchiveLookupResult } from "@/app/api/osint/archive/route";
import { useInvestigation } from "@/contexts/InvestigationContext";

export default function ArchiveLookup() {
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ArchiveLookupResult | null>(null);
  const { incrementSessionCount, mergeGraph, setToolAlert, addTimelineEvent } = useInvestigation();

  async function scan() {
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/osint/archive?target=${encodeURIComponent(target.trim())}`);
      const json: ArchiveLookupResult = await res.json();
      if (!res.ok) {
        setError((json as any).error ?? `HTTP ${res.status}`);
        return;
      }
      setData(json);
      incrementSessionCount();
      addTimelineEvent({ tool: "recon", label: "Wayback Archive lookup", detail: target.trim() });
      setToolAlert("recon", json.timeline.status === "ok" && json.timeline.data.totalCaptures > 0);
    } catch {
      setError("Network error reaching the archive lookup API.");
    } finally {
      setLoading(false);
    }
  }

  function pinToGraph() {
    if (!data || data.timeline.status !== "ok") return;
    const id = `archive:${data.target}`;
    mergeGraph(
      [{ id, type: "subdomain", label: `Archive: ${data.target}`, detail: `${data.timeline.data.totalCaptures} captures, ${data.timeline.data.firstCapture?.slice(0, 10)} → ${data.timeline.data.lastCapture?.slice(0, 10)}` }],
      []
    );
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <Archive className="h-3.5 w-3.5 text-accent" /> Wayback Machine / Archive Lookup
      </p>
      <p className="text-[11px] text-slate-500">
        Pulls historical snapshots of a URL or domain from archive.org — the latest capture, a
        first/last-seen timeline, and a sample of individual snapshots you can open directly. Free,
        keyless, no rate-limit key required.
      </p>
      <p className="text-[11px] text-amber-300/80 bg-amber-900/10 border border-amber-700/30 rounded-lg p-2">
        Facebook and Instagram block archive.org from crawling profile pages (they sit behind a
        login wall), so this almost never finds snapshots for them — that's a limitation of those
        platforms, not this tool. Enter the exact profile URL if you want to try anyway (e.g.
        instagram.com/username), but for finding what's publicly visible about a profile, the{" "}
        <span className="text-slate-300">Google Dork Builder</span>&apos;s social-media dorks below
        are the more reliable path.
      </p>

      <div className="flex gap-2">
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && scan()}
          placeholder="e.g. example.com or https://example.com/page"
          dir="ltr"
          className="flex-1 bg-panel/60 border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
        />
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={scan}
          disabled={loading || !target.trim()}
          className="text-xs px-3 py-1.5 rounded-md bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Lookup"}
        </motion.button>
      </div>

      {error && <p className="text-xs text-red-300">{error}</p>}

      {data && !loading && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1">Latest snapshot</p>
            <ProviderBadge state={data.latest} label="Wayback Availability API" />
            {data.latest.status === "ok" && (
              <a
                href={data.latest.data.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-accent-glow hover:underline mt-1"
              >
                <ExternalLink className="h-3 w-3" /> View snapshot from {new Date(data.latest.data.date).toLocaleDateString()}
              </a>
            )}
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1">Capture timeline</p>
            <ProviderBadge state={data.timeline} label="Wayback CDX API" />
            {data.timeline.status === "ok" && (
              <div className="flex flex-wrap gap-3 text-xs text-slate-300 mt-1">
                <span><span className="text-slate-500">First seen:</span> {new Date(data.timeline.data.firstCapture!).toLocaleDateString()}</span>
                <span><span className="text-slate-500">Last seen:</span> {new Date(data.timeline.data.lastCapture!).toLocaleDateString()}</span>
                <span><span className="text-slate-500">Total captures:</span> {data.timeline.data.totalCaptures.toLocaleString()}</span>
                <span><span className="text-slate-500">Years active:</span> {data.timeline.data.yearsActive.join(", ")}</span>
              </div>
            )}
          </div>

          {data.snapshots.status === "ok" && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1">
                Sampled snapshots {data.snapshots.data.truncated && `(${data.snapshots.data.items.length} of ${data.timeline.status === "ok" ? data.timeline.data.totalCaptures : "?"})`}
              </p>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-[#0d0a18] p-2 space-y-1">
                {data.snapshots.data.items.map((s) => (
                  <a
                    key={s.timestamp}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 text-xs font-mono text-slate-300 hover:text-accent-glow transition-colors"
                  >
                    <span>{new Date(s.date).toLocaleString()}</span>
                    <span className="text-slate-600">HTTP {s.statusCode}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {data.timeline.status === "ok" && (
            <button
              onClick={pinToGraph}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
            >
              <Pin className="h-3 w-3" /> Pin to Intelligence Graph
            </button>
          )}
        </motion.div>
      )}
    </div>
  );
}
