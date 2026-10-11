"use client";

import { useState } from "react";
import { useInvestigation } from "@/contexts/InvestigationContext";
import { indicatorLabel } from "@/lib/detectIndicator";
import { Loader2, X, ExternalLink, ShieldAlert } from "lucide-react";
import { ProviderBadge } from "@/components/ResolvedIpPanel";

/**
 * Handles hash and CVE quick-lookups. IP and domain targets are handed
 * off to their own dedicated tools (IpAnalyzer / DomainScan) — see
 * InvestigationContext's runLookup.
 */
export default function ResultsPanel() {
  const { query, type, loading, error, data } = useInvestigation();
  const [dismissed, setDismissed] = useState(false);

  const isSupportedType = type === "md5" || type === "sha1" || type === "sha256" || type === "cve";

  if (dismissed) return null;
  if (!query && !loading) return null;
  if (!isSupportedType && !loading && !error) return null;

  return (
    <div className="glass-panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-display font-semibold text-sm text-slate-100">
            {type === "cve" ? "CVE Lookup" : "Hash Lookup"}
          </h2>
          <p className="text-xs text-slate-500 font-mono">
            {query} {type !== "unknown" && `· ${indicatorLabel(type)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="h-4 w-4 text-accent animate-spin" />}
          <button onClick={() => setDismissed(true)} className="text-slate-500 hover:text-slate-300" aria-label="Dismiss results">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-300/90 bg-red-900/20 border border-red-700/40 rounded-lg p-3">{error}</div>
      )}

      {loading && (
        <div className="space-y-2 animate-pulse">
          {[...Array(3)].map((_, i) => <div key={i} className="h-4 bg-border/60 rounded w-3/4" />)}
        </div>
      )}

      {data && !loading && type === "cve" && (
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2 flex-wrap">
            {data.score !== null && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-severity-critical/25 text-red-300 border border-severity-critical/40">
                CVSS {data.score} {data.severity && `(${data.severity})`}
              </span>
            )}
            {data.inKev && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-red-900/30 text-red-300 border border-red-700/50">
                Actively exploited (CISA KEV)
              </span>
            )}
            {data.epss && (
              <span className="text-xs px-2.5 py-1 rounded-lg bg-panel border border-border text-slate-300">
                EPSS {(data.epss.score * 100).toFixed(1)}% (top {(100 - data.epss.percentile * 100).toFixed(0)}%ile)
              </span>
            )}
          </div>

          <div className={`rounded-lg border p-3 ${
            data.careAssessment.level === "URGENT" ? "bg-red-900/25 border-red-700/50" :
            data.careAssessment.level === "HIGH" ? "bg-orange-900/20 border-orange-700/40" :
            data.careAssessment.level === "MODERATE" ? "bg-amber-900/15 border-amber-700/30" :
            "bg-emerald-900/15 border-emerald-700/30"
          }`}>
            <p className="text-xs font-bold mb-1.5">WHY SHOULD I CARE? — {data.careAssessment.level}</p>
            <ul className="space-y-0.5">
              {data.careAssessment.reasons.map((r: string, i: number) => (
                <li key={i} className="text-[11px] text-slate-300">• {r}</li>
              ))}
            </ul>
          </div>

          <p className="text-slate-300 leading-relaxed">{data.description}</p>

          {data.cwe?.length > 0 && (
            <p className="text-xs text-slate-400">
              <span className="text-slate-500">Weakness type:</span> {data.cwe.join(", ")}
            </p>
          )}

          {data.affectedProducts?.length > 0 && (
            <div>
              <p className="text-[11px] text-slate-500 mb-1">Affected products</p>
              <div className="space-y-0.5 max-h-24 overflow-y-auto">
                {data.affectedProducts.map((p: string) => (
                  <p key={p} className="text-[11px] font-mono text-slate-400 break-all">{p}</p>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-slate-500">
            Published {data.published ? new Date(data.published).toLocaleDateString() : "unknown"}
            {data.lastModified && ` · Last modified ${new Date(data.lastModified).toLocaleDateString()}`}
          </p>
          {data.references?.length > 0 && (
            <div className="space-y-1 pt-2 border-t border-border">
              <p className="text-[11px] text-slate-500">References</p>
              {data.references.map((url: string) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-accent-glow hover:underline break-all">
                  <ExternalLink className="h-3 w-3 shrink-0" /> {url}
                </a>
              ))}
            </div>
          )}
          <p className="text-[10px] text-slate-600">Sources: NVD (NIST) · CISA KEV · FIRST.org EPSS</p>
        </div>
      )}

      {data && !loading && type !== "cve" && (
        <div className="space-y-2 text-sm">
          <ProviderBadge state={data.circlHashlookup} label="CIRCL hashlookup" />
          {data.circlHashlookup?.status === "ok" && (
            <p className="text-slate-300">Matches a known file: {data.circlHashlookup.data.fileName ?? "Unnamed"}</p>
          )}
          {data.circlHashlookup?.status === "not_found" && (
            <p className="text-xs text-amber-300/90">
              Not in the known-good file database — this doesn't mean it's malicious, only that
              it isn't a recognized system/software file. Treat as unverified.
            </p>
          )}
          {data.circlHashlookup?.status === "ok" && data.circlHashlookup.data.trustLevel !== null && (
            <p className="text-emerald-300 text-xs">Trust level: {data.circlHashlookup.data.trustLevel}/100</p>
          )}
        </div>
      )}
    </div>
  );
}
