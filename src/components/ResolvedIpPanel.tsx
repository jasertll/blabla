"use client";

import { useEffect, useState } from "react";
import { Loader2, KeyRound, AlertOctagon } from "lucide-react";
import type { IpLookupResult, ProviderState } from "@/lib/osintTypes";
import { lookupPort } from "@/lib/portIntel";
import { buildAttackSurfaceGraph } from "@/lib/ipAttackSurface";
import AttackSurfaceMap from "@/components/ipAnalyzer/AttackSurfaceMap";

export function ProviderBadge({ state, label }: { state: ProviderState<any> | undefined; label: string }) {
  if (!state) return null;

  if (state.status === "missing_key") {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-300/90 bg-amber-900/20 border border-amber-700/40 rounded-lg p-2.5">
        <KeyRound className="h-3.5 w-3.5 shrink-0" />
        <span>
          {label} needs an API key. Add <code className="font-mono">{state.envVar}</code> to
          your <code className="font-mono">.env.local</code>.
        </span>
      </div>
    );
  }
  if (state.status === "rate_limited") {
    return (
      <div className="flex items-center gap-2 text-xs text-orange-300/90 bg-orange-900/20 border border-orange-700/40 rounded-lg p-2.5">
        <AlertOctagon className="h-3.5 w-3.5 shrink-0" />
        {label} rate limit reached — try again shortly.
      </div>
    );
  }
  if (state.status === "not_found") {
    return <p className="text-xs text-slate-500">{label}: no data on file for this indicator.</p>;
  }
  if (state.status === "error") {
    return (
      <div className="flex items-center gap-2 text-xs text-red-300/90 bg-red-900/20 border border-red-700/40 rounded-lg p-2.5">
        <AlertOctagon className="h-3.5 w-3.5 shrink-0" />
        {label} error: {state.message}
      </div>
    );
  }
  return null;
}

export function DomainAgeSignal({ createdDate }: { createdDate: string | null }) {
  if (!createdDate) {
    return <p className="text-xs text-slate-500">No registration date available (RDAP lookup failed or unsupported TLD).</p>;
  }
  const created = new Date(createdDate);
  if (isNaN(created.getTime())) {
    return <p className="text-xs text-slate-500">Registration date: {createdDate}</p>;
  }
  const ageDays = Math.round((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));

  let tone = "text-emerald-300";
  let note = "Established domain — age alone doesn't raise concern.";
  if (ageDays < 30) {
    tone = "text-red-300";
    note = "Registered under 30 days ago — very commonly seen with phishing/malware infrastructure. Treat with extra caution.";
  } else if (ageDays < 180) {
    tone = "text-amber-300";
    note = "Registered under 6 months ago — worth a second look, though many legitimate sites are this young too.";
  }

  return (
    <div>
      <p className={`text-xs ${tone}`}>{ageDays.toLocaleString()} days old (registered {created.toLocaleDateString()})</p>
      <p className="text-[11px] text-slate-500 mt-1">{note}</p>
    </div>
  );
}

export function useResolvedIp(ip: string | undefined) {
  const [data, setData] = useState<IpLookupResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ip) return;
    setLoading(true);
    fetch(`/api/osint/ip?target=${encodeURIComponent(ip)}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [ip]);

  return { data, loading };
}

// Cross-references vulns already found for a resolved IP against the real,
// full CISA KEV catalog — the same properly-scoped check used by the IP
// Analyzer itself, reused here so a domain's auto-scanned resolved IP gets
// identical, non-duplicated real analysis rather than a plain CVE list.
function useKevMatches(vulns: string[]) {
  const [matches, setMatches] = useState<string[]>([]);
  const key = vulns.join(",");
  useEffect(() => {
    if (vulns.length === 0) {
      setMatches([]);
      return;
    }
    fetch(`/api/osint/kevcheck?cves=${encodeURIComponent(key)}`)
      .then((r) => r.json())
      .then((json) => setMatches((json.matches ?? []).map((m: { cveID: string }) => m.cveID)))
      .catch(() => setMatches([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return matches;
}

export function ResolvedIpPorts({ ip }: { ip: string | undefined }) {
  const { data, loading } = useResolvedIp(ip);
  const internetdb = data?.internetdb.status === "ok" ? data.internetdb.data : null;
  const kevMatches = useKevMatches(internetdb?.vulns ?? []);

  if (!ip) return <p className="text-xs text-slate-500">No resolved IP to scan (no A record found).</p>;
  if (loading) return <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning resolved IP {ip}…</div>;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-500">
        Auto-scanned resolved IP: <span className="font-mono text-slate-400">{ip}</span>
      </p>
      {!internetdb && <p className="text-xs text-slate-500">No open-port data on record for this IP.</p>}
      {internetdb && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {internetdb.ports.length === 0 && <span className="text-xs text-slate-500">No open ports on record.</span>}
            {internetdb.ports.map((p) => {
              const profile = lookupPort(p);
              const cls = profile.risk === "elevated" ? "border-red-700/50 text-red-300" : profile.risk === "notable" ? "border-amber-700/50 text-amber-300" : "border-border text-slate-300";
              return (
                <span key={p} title={profile.note} className={`text-xs font-mono px-2 py-1 rounded bg-panel border ${cls}`}>
                  :{p} {profile.service}
                </span>
              );
            })}
          </div>
          {internetdb.vulns.length > 0 && (
            <ul className="space-y-1 mt-2">
              {internetdb.vulns.map((v) => (
                <li key={v} className="text-xs font-mono text-red-300 flex items-center gap-1.5">
                  {v}
                  {kevMatches.includes(v) && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded border border-red-600/60 bg-red-950/60 text-red-300 font-sans">CISA KEV — actively exploited</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// Reuses the IP Analyzer's own attack-surface graph for a domain's
// resolved IP — same real, evidence-based node/edge construction, not a
// separate reimplementation.
export function ResolvedIpAttackSurface({ ip }: { ip: string | undefined }) {
  const { data, loading } = useResolvedIp(ip);
  const internetdb = data?.internetdb.status === "ok" ? data.internetdb.data : null;
  const kevMatches = useKevMatches(internetdb?.vulns ?? []);

  if (!ip) return <p className="text-xs text-slate-500">No resolved IP to map (no A record found).</p>;
  if (loading) return <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Building attack surface for {ip}…</div>;
  if (!data) return <p className="text-xs text-slate-500">No data available for this IP.</p>;

  const { nodes, edges } = buildAttackSurfaceGraph(ip, data, kevMatches);
  return <AttackSurfaceMap nodes={nodes} edges={edges} />;
}

export function ResolvedIpReputation({ ip }: { ip: string | undefined }) {
  const { data, loading } = useResolvedIp(ip);

  if (!ip) return <p className="text-xs text-slate-500">No resolved IP to check.</p>;
  if (loading) return <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking {ip}…</div>;

  const geo = data?.geo.status === "ok" ? data.geo.data : null;
  const tor = data?.tor.status === "ok" ? data.tor.data : null;

  return (
    <div className="space-y-2 text-xs">
      {geo && (
        <>
          <p className="text-slate-300">{geo.isp ?? "Unknown ISP"} · {geo.country ?? "Unknown"}</p>
          <div className="flex gap-1.5 flex-wrap">
            {geo.isProxy && <span className="px-1.5 py-0.5 rounded bg-severity-high/25 text-orange-300 border border-severity-high/40 text-[10px]">Proxy</span>}
            {geo.isHosting && <span className="px-1.5 py-0.5 rounded bg-panel text-slate-300 border border-border text-[10px]">Hosting/Datacenter</span>}
          </div>
        </>
      )}
      {tor?.isTorExitNode && <p className="text-red-300">⚠ Resolved IP is a known Tor exit node.</p>}
      {!geo && <p className="text-slate-500">No geolocation/hosting data available for this IP.</p>}
    </div>
  );
}
