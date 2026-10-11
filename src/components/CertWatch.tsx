"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ShieldAlert, Loader2, Eye, EyeOff, Bell, ExternalLink, Asterisk } from "lucide-react";
import { useInvestigation } from "@/contexts/InvestigationContext";
import type { CertRecord } from "@/lib/certwatch";
import type { WatchedDomainStatus } from "@/app/api/osint/certwatch/list/route";
import { flagSubdomain } from "@/lib/subdomainRisk";

function fmtDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function CertRow({ cert, isNew }: { cert: CertRecord; isNew?: boolean }) {
  const hasWildcard = cert.names.some((n) => n.startsWith("*."));
  const sensitiveFlags = new Map<string, string>();
  for (const n of cert.names) {
    for (const f of flagSubdomain(n)) sensitiveFlags.set(f.keyword, f.reason);
  }
  const flagged = hasWildcard || sensitiveFlags.size > 0;

  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${flagged ? "border-red-600/50 bg-red-950/20" : isNew ? "border-amber-500/40 bg-amber-500/10" : "border-border bg-surface-elevated"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-slate-200 truncate">{cert.commonName || cert.names[0] || "(no CN)"}</span>
        <a
          href={`https://crt.sh/?id=${cert.id}`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-slate-500 hover:text-accent-glow"
          title="View on crt.sh"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <p className="text-[11px] text-slate-500 mt-1">
        {cert.issuer} · {fmtDate(cert.notBefore)} → {fmtDate(cert.notAfter)}
      </p>
      {cert.names.length > 1 && (
        <p className="text-[11px] text-slate-600 mt-1 truncate" title={cert.names.join(", ")}>
          +{cert.names.length - 1} more name{cert.names.length - 1 === 1 ? "" : "s"}
        </p>
      )}
      {(hasWildcard || sensitiveFlags.size > 0) && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {hasWildcard && (
            <span title="A wildcard cert covers ANY subdomain — worth confirming this was intentionally issued." className="text-[9px] px-1.5 py-0.5 rounded border border-red-700/50 text-red-300 flex items-center gap-0.5">
              <Asterisk className="h-2.5 w-2.5" /> wildcard
            </span>
          )}
          {Array.from(sensitiveFlags.entries()).map(([kw, reason]) => (
            <span key={kw} title={reason} className="text-[9px] px-1.5 py-0.5 rounded border border-amber-700/50 text-amber-300">{kw}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CertWatch() {
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [certs, setCerts] = useState<CertRecord[] | null>(null);
  const [watching, setWatching] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchlist, setWatchlist] = useState<WatchedDomainStatus[] | null>(null);
  const [watchlistConfigured, setWatchlistConfigured] = useState(true);
  const { incrementSessionCount, addTimelineEvent, setToolAlert } = useInvestigation();

  async function loadWatchlist() {
    try {
      const res = await fetch("/api/osint/certwatch/list");
      const json = await res.json();
      setWatchlistConfigured(json.configured !== false);
      setWatchlist(json.domains ?? []);
      setToolAlert("certwatch", (json.domains ?? []).some((d: WatchedDomainStatus) => d.newCerts.length > 0));
    } catch {
      setWatchlist([]);
    }
  }

  useEffect(() => {
    loadWatchlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function check() {
    const target = domain.trim().toLowerCase();
    if (!target) return;
    setLoading(true);
    setError(null);
    setCerts(null);
    try {
      const res = await fetch(`/api/osint/certwatch?domain=${encodeURIComponent(target)}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.message ?? `HTTP ${res.status}`);
        return;
      }
      setCerts(json.certs);
      setWatching(json.watching);
      incrementSessionCount();
      addTimelineEvent({ tool: "certwatch", label: "Certificate check", detail: `${target} — ${json.certs.length} cert(s)` });
    } catch {
      setError("Network error reaching crt.sh.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleWatch() {
    const target = domain.trim().toLowerCase();
    if (!target || watchBusy) return;
    setWatchBusy(true);
    try {
      const res = await fetch("/api/osint/certwatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: target, action: watching ? "unwatch" : "watch" }),
      });
      const json = await res.json();
      if (res.ok) {
        setWatching(!!json.watching);
        loadWatchlist();
      }
    } finally {
      setWatchBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass-panel p-4 space-y-4">
        <div>
          <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-accent" /> Certificate Check
          </h2>
          <p className="text-xs text-slate-500">
            Every publicly-trusted TLS certificate ever issued for a domain shows up in Certificate
            Transparency logs, usually within minutes — the earliest keyless signal that new
            infrastructure (a lookalike subdomain, a forgotten dev box) just went live.
          </p>
        </div>

        <div className="flex gap-2">
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && check()}
            placeholder="example.com"
            dir="ltr"
            className="flex-1 bg-panel/60 border border-border rounded-lg px-3 py-2 text-sm font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
          />
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={check}
            disabled={loading || !domain.trim()}
            className="text-sm px-4 py-2 rounded-lg bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
          </motion.button>
        </div>
        {error && <p className="text-xs text-red-300">{error}</p>}

        {certs && !loading && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400">
                {certs.length} certificate{certs.length === 1 ? "" : "s"} found
                {certs.length === 0 && " — nothing issued for this domain yet, or crt.sh hasn't indexed it."}
                {(() => {
                  const flaggedCount = certs.filter((c) => c.names.some((n) => n.startsWith("*.")) || c.names.some((n) => flagSubdomain(n).length > 0)).length;
                  return flaggedCount > 0 ? `, ${flaggedCount} flagged (wildcard or sensitive-name)` : "";
                })()}
              </p>
              <button
                onClick={toggleWatch}
                disabled={watchBusy || !watchlistConfigured}
                title={!watchlistConfigured ? "Needs Redis — see README" : undefined}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition-colors disabled:opacity-40 ${
                  watching
                    ? "border-accent/50 bg-accent/10 text-accent-glow"
                    : "border-border text-slate-400 hover:border-accent/50 hover:text-slate-200"
                }`}
              >
                {watching ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                {watching ? "Watching" : "Watch this domain"}
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 max-h-96 overflow-y-auto pr-1">
              {certs.map((c) => (
                <CertRow key={c.id} cert={c} />
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {watchlistConfigured && watchlist && watchlist.length > 0 && (
        <div className="glass-panel p-4 space-y-3">
          <h3 className="font-display font-semibold text-sm text-slate-100 flex items-center gap-2">
            <Bell className="h-4 w-4 text-accent" /> Watchlist ({watchlist.length})
          </h3>
          <div className="space-y-3">
            {watchlist.map((w) => (
              <div key={w.domain} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-slate-200">{w.domain}</span>
                  <span className="text-[11px] text-slate-500">{w.totalCerts} total cert{w.totalCerts === 1 ? "" : "s"}</span>
                </div>
                {w.error && <p className="text-[11px] text-red-300">{w.error}</p>}
                {w.newCerts.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold text-amber-300 flex items-center gap-1">
                      <ShieldAlert className="h-3 w-3" /> {w.newCerts.length} new certificate{w.newCerts.length === 1 ? "" : "s"} since last check
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {w.newCerts.map((c) => (
                        <CertRow key={c.id} cert={c} isNew />
                      ))}
                    </div>
                  </div>
                ) : (
                  !w.error && <p className="text-[11px] text-slate-600">No new certificates since last check.</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
