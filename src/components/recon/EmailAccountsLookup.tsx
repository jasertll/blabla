"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Mail, Loader2, ExternalLink, Pin, ShieldAlert, FileDown } from "lucide-react";
import { ProviderBadge } from "@/components/ResolvedIpPanel";
import type { EmailLookupResult } from "@/app/api/osint/email/route";
import { useInvestigation } from "@/contexts/InvestigationContext";
import { buildEmailReport, openReport } from "@/lib/reportGenerator";

export default function EmailAccountsLookup() {
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EmailLookupResult | null>(null);
  const { incrementSessionCount, mergeGraph, setToolAlert, addTimelineEvent } = useInvestigation();

  async function scan() {
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/osint/email?email=${encodeURIComponent(target.trim())}`);
      const json: EmailLookupResult = await res.json();
      if (!res.ok) {
        setError((json as any).error ?? `HTTP ${res.status}`);
        return;
      }
      setData(json);
      incrementSessionCount();
      addTimelineEvent({ tool: "recon", label: "Email account lookup", detail: target.trim() });
      setToolAlert("recon", json.breaches.status === "ok" && json.breaches.data.items.length > 0);
    } catch {
      setError("Network error reaching the email lookup API.");
    } finally {
      setLoading(false);
    }
  }

  function pinToGraph() {
    if (!data) return;
    const id = `email:${data.target}`;
    const breachCount = data.breaches.status === "ok" ? data.breaches.data.items.length : 0;
    mergeGraph(
      [{ id, type: "email", label: data.target, detail: breachCount > 0 ? `${breachCount} known breaches` : "email lookup", raw: data }],
      []
    );
  }

  function exportReport() {
    if (!data) return;
    openReport(buildEmailReport(data.target, data));
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <Mail className="h-3.5 w-3.5 text-accent" /> Email → Accounts / Breach Lookup
      </p>
      <p className="text-[11px] text-slate-500">
        Two real, always-free-and-keyless sources: <span className="text-slate-300">Gravatar</span>{" "}
        (does a public profile/photo exist for this email?) and{" "}
        <span className="text-slate-300">XposedOrNot</span> (which real data breaches this email
        appeared in — the closest honest equivalent to "which accounts is it registered on," since
        most services don't expose account existence via a safe public API). Add{" "}
        <code className="font-mono">HIBP_API_KEY</code> (optional, paid) for richer per-breach
        detail from HaveIBeenPwned on top of that.
      </p>

      <div className="flex gap-2">
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && scan()}
          placeholder="e.g. name@example.com"
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
            <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1">Gravatar</p>
            <ProviderBadge state={data.gravatar} label="Gravatar" />
            {data.gravatar.status === "ok" && (
              <div className="flex items-center gap-3 mt-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={data.gravatar.data.avatarUrl}
                  alt="Gravatar"
                  className="h-12 w-12 rounded-full border border-border"
                />
                <div className="text-xs text-slate-300">
                  <p>{data.gravatar.data.displayName ?? <span className="text-slate-500">No public display name</span>}</p>
                  {data.gravatar.data.profileUrl && (
                    <a
                      href={data.gravatar.data.profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-accent-glow hover:underline mt-0.5"
                    >
                      <ExternalLink className="h-3 w-3" /> View Gravatar profile
                    </a>
                  )}
                </div>
              </div>
            )}
            {data.gravatar.status === "not_found" && (
              <p className="text-xs text-slate-500 mt-1">No Gravatar registered for this email.</p>
            )}
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1">Known data breaches</p>
            <ProviderBadge state={data.breaches} label="Breach lookup" />
            {data.breaches.status === "not_found" && (
              <p className="text-xs text-emerald-300/90">Not found in any known breach on file.</p>
            )}
            {data.breaches.status === "ok" && (
              <div className="space-y-1.5 mt-1">
                <p className="text-xs text-red-300 flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5" /> Found in {data.breaches.data.items.length} known breach
                  {data.breaches.data.items.length === 1 ? "" : "es"}
                  <span className="text-slate-600 font-normal">via {data.breaches.data.source}</span>
                </p>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-[#0d0a18] p-2 space-y-2">
                  {data.breaches.data.items.map((b) => (
                    <div key={b.name} className="text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-200 font-medium">{b.name}</span>
                        {b.breachDate && <span className="text-slate-600 font-mono">{b.breachDate}</span>}
                      </div>
                      {b.dataClasses.length > 0 && (
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {b.dataClasses.slice(0, 6).join(", ")}
                          {b.dataClasses.length > 6 && ` +${b.dataClasses.length - 6} more`}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                {data.breaches.data.source === "XposedOrNot" && (
                  <p className="text-[10px] text-slate-600">
                    Breach names only — add <code className="font-mono">HIBP_API_KEY</code> for per-breach
                    dates and exposed data types too.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={pinToGraph}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
            >
              <Pin className="h-3 w-3" /> Pin to Intelligence Graph
            </button>
            <button
              onClick={exportReport}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
            >
              <FileDown className="h-3 w-3" /> Export Report
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
