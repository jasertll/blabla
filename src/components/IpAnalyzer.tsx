"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Globe2, Loader2, FileDown } from "lucide-react";
import { useInvestigation } from "@/contexts/InvestigationContext";
import { ProviderBadge } from "@/components/ResolvedIpPanel";
import { buildIpReport, openReport } from "@/lib/reportGenerator";
import { buildGraphFromIpScan } from "@/lib/intelligenceGraph";
import { scoreIp } from "@/lib/riskScore";
import { buildAttackSurfaceGraph } from "@/lib/ipAttackSurface";
import AttackSurfaceMap from "@/components/ipAnalyzer/AttackSurfaceMap";
import { lookupPort } from "@/lib/portIntel";
import type { IpLookupResult } from "@/lib/osintTypes";
import InvestigationHeader from "@/components/InvestigationHeader";

const TABS = ["Overview", "Attack Surface", "Open Ports", "Security Records", "Reputation"] as const;
type Tab = (typeof TABS)[number];

export default function IpAnalyzer() {
  const [ip, setIp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<IpLookupResult | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [kevMatches, setKevMatches] = useState<string[]>([]);
  const { handoff, clearHandoff, addLocation, incrementSessionCount, mergeGraph, setToolAlert, addTimelineEvent } = useInvestigation();

  async function scan(target: string) {
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    setKevMatches([]);
    try {
      const res = await fetch(`/api/osint/ip?target=${encodeURIComponent(target.trim())}`);
      const json = await res.json();
      setData(json);
      incrementSessionCount();
      const { nodes, edges } = buildGraphFromIpScan(target.trim(), json);
      mergeGraph(nodes, edges);
      addTimelineEvent({ tool: "ip", label: "IP scan", detail: target.trim() });

      // Cross-reference any CVEs this host has against the REAL, full
      // CISA KEV catalog (not the truncated "latest 15" feed) — this is
      // what actually distinguishes "a theoretical weakness" from
      // "confirmed being exploited in the wild right now."
      let matchedCves: string[] = [];
      const vulns: string[] = json.internetdb?.status === "ok" ? json.internetdb.data.vulns : [];
      if (vulns.length > 0) {
        try {
          const kevRes = await fetch(`/api/osint/kevcheck?cves=${encodeURIComponent(vulns.join(","))}`);
          const kevJson = await kevRes.json();
          matchedCves = (kevJson.matches ?? []).map((m: { cveID: string }) => m.cveID);
          setKevMatches(matchedCves);
        } catch {
          // Keyless best-effort cross-reference — scoring/display just
          // falls back to the plain CVE-count signal without it.
        }
      }

      setToolAlert("ip", scoreIp(json, matchedCves).label === "HIGH");
      if (json.geo?.status === "ok" && json.geo.data.lat !== null && json.geo.data.lon !== null) {
        addLocation({
          label: target.trim(),
          lat: json.geo.data.lat,
          lon: json.geo.data.lon,
          country: json.geo.data.country,
        });
      }
    } catch {
      setError("Network error reaching the lookup API.");
    } finally {
      setLoading(false);
    }
  }

  // Picks up a handoff from the top search bar (auto-detected IP).
  useEffect(() => {
    if (handoff?.tool === "ip") {
      setIp(handoff.value);
      scan(handoff.value);
      clearHandoff();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  return (
    <div className="glass-panel p-4 space-y-4">
      <div>
        <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
          <Globe2 className="h-4 w-4 text-accent" /> IP / ASN Analyzer
        </h2>
        <p className="text-xs text-slate-500">
          Open ports, known CVEs, geolocation, network ownership, and hosting/Tor signals — all
          from free, keyless sources (Shodan InternetDB, ip-api.com, BGPView, RDAP, Tor Project).
          Every CVE found is cross-referenced against CISA's real, full Known Exploited
          Vulnerabilities catalog (not just a "has a CVE" count — confirmed active exploitation is
          weighted far higher), and open ports are mapped to real MITRE ATT&CK techniques via a
          curated port/service risk table, visualized as an interactive attack-surface graph.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && scan(ip)}
          placeholder="e.g. 8.8.8.8"
          dir="ltr"
          className="flex-1 bg-panel/60 border border-border rounded-lg px-3 py-2 text-sm font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
        />
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => scan(ip)}
          disabled={loading || !ip.trim()}
          className="text-xs px-3 py-2 rounded-md bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Scan"}
        </motion.button>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      {data && !loading && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 text-sm">
          <InvestigationHeader target={ip} />
          <div className="flex items-center justify-between">
            <nav className="flex gap-1 border-b border-border flex-1">
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
                    tab === t ? "border-accent text-slate-100" : "border-transparent text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {t}
                </button>
              ))}
            </nav>
            <button
              onClick={() => openReport(buildIpReport(ip, data))}
              className="flex items-center gap-1 text-[11px] px-2 py-1 ml-2 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors shrink-0"
            >
              <FileDown className="h-3.5 w-3.5" /> Export Report
            </button>
          </div>

          {tab === "Overview" && (
            <div className="space-y-2">
              <ProviderBadge state={data.internetdb} label="Shodan InternetDB" />
              <ProviderBadge state={data.geo} label="ip-api.com" />
              {data.geo?.status === "ok" && (
                <p className="text-slate-300">
                  {data.geo.data.isp ?? "Unknown ISP"} · {data.geo.data.city ?? "?"}, {data.geo.data.country ?? "Unknown"}
                </p>
              )}
              {data.geo?.status === "ok" && (data.geo.data.isProxy || data.geo.data.isHosting || data.geo.data.isMobile) && (
                <div className="flex gap-1.5 flex-wrap">
                  {data.geo.data.isProxy && <span className="text-[10px] px-1.5 py-0.5 rounded bg-severity-high/25 text-orange-300 border border-severity-high/40">Proxy</span>}
                  {data.geo.data.isHosting && <span className="text-[10px] px-1.5 py-0.5 rounded bg-panel text-slate-300 border border-border">Hosting/Datacenter</span>}
                  {data.geo.data.isMobile && <span className="text-[10px] px-1.5 py-0.5 rounded bg-panel text-slate-300 border border-border">Mobile Carrier</span>}
                </div>
              )}
              {data.tor?.status === "ok" && data.tor.data.isTorExitNode && (
                <p className="text-xs text-red-300">⚠ This IP is a known Tor exit node.</p>
              )}
              {data.reverseDns?.status === "ok" && (
                <p className="text-xs text-slate-400 font-mono">PTR: {data.reverseDns.data.hostnames.join(", ")}</p>
              )}

              <div className="pt-2 mt-2 border-t border-border/60 space-y-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-600">Network / ASN</p>
                <ProviderBadge state={data.asn} label="BGPView" />
                {data.asn?.status === "ok" && (
                  <p className="text-slate-300">
                    <span className="font-mono text-accent-glow">AS{data.asn.data.asn ?? "?"}</span>{" "}
                    {data.asn.data.holder ?? "Unknown holder"}
                    {data.asn.data.prefix && <span className="text-slate-500 font-mono"> · {data.asn.data.prefix}</span>}
                    {data.asn.data.countryCode && <span className="text-slate-500"> · {data.asn.data.countryCode}</span>}
                  </p>
                )}
                {data.asn?.status === "ok" && data.asn.data.rir && (
                  <p className="text-[11px] text-slate-500">
                    Allocated by {data.asn.data.rir}
                    {data.asn.data.allocationDate && ` on ${new Date(data.asn.data.allocationDate).toLocaleDateString()}`}
                  </p>
                )}

                <ProviderBadge state={data.rdap} label="RDAP" />
                {data.rdap?.status === "ok" && (
                  <p className="text-slate-300">
                    {data.rdap.data.org ?? data.rdap.data.name ?? "Unknown registrant"}
                    {data.rdap.data.cidr && <span className="text-slate-500 font-mono"> · {data.rdap.data.cidr}</span>}
                    {data.rdap.data.country && <span className="text-slate-500"> · {data.rdap.data.country}</span>}
                  </p>
                )}
              </div>
            </div>
          )}

          {tab === "Attack Surface" && (() => {
            const { nodes, edges } = buildAttackSurfaceGraph(ip, data, kevMatches);
            return <AttackSurfaceMap nodes={nodes} edges={edges} />;
          })()}

          {tab === "Open Ports" && (
            <div>
              <ProviderBadge state={data.internetdb} label="Shodan InternetDB" />
              {data.internetdb?.status === "ok" && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {data.internetdb.data.ports.length === 0 && <p className="text-xs text-slate-500">No open ports on record.</p>}
                  {data.internetdb.data.ports.map((p: number) => {
                    const profile = lookupPort(p);
                    const riskClass = profile.risk === "elevated" ? "border-red-700/50 text-red-300" : profile.risk === "notable" ? "border-amber-700/50 text-amber-300" : "border-border text-slate-300";
                    return (
                      <span key={p} title={profile.note} className={`text-xs font-mono px-2 py-1 rounded bg-panel border ${riskClass}`}>
                        :{p} <span className="text-slate-500">{profile.service}</span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "Security Records" && (
            <div>
              <ProviderBadge state={data.internetdb} label="Shodan InternetDB" />
              {data.internetdb?.status === "ok" && data.internetdb.data.vulns.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {data.internetdb.data.vulns.map((v: string) => (
                    <li key={v} className="text-xs font-mono text-red-300 flex items-center gap-2">
                      {v}
                      {kevMatches.includes(v) && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-950/60 border border-red-700/60 text-red-300 font-sans">CISA KEV — actively exploited</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {data.internetdb?.status === "ok" && data.internetdb.data.vulns.length === 0 && (
                <p className="text-xs text-slate-500">No known CVEs flagged for this host.</p>
              )}
            </div>
          )}

          {tab === "Reputation" && (() => {
            const score = scoreIp(data, kevMatches);
            const riskColor = score.label === "HIGH" ? "text-red-300 border-red-700/40 bg-red-900/20" : score.label === "MEDIUM" ? "text-amber-300 border-amber-700/40 bg-amber-900/20" : "text-emerald-300 border-emerald-700/40 bg-emerald-900/20";
            return (
              <div className="space-y-3">
                <div className={`rounded-lg border p-3 ${riskColor}`}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl font-display font-bold">{score.total}/100</span>
                    <span className="text-xs font-bold">{score.label} RISK</span>
                  </div>
                  <div className="space-y-1 pt-2 border-t border-current/20">
                    {score.factors.map((f, i) => (
                      <p key={i} className="text-[11px] text-slate-300">
                        <span className="font-mono font-bold">{f.points > 0 ? `+${f.points}` : "0"}</span> {f.reason}
                      </p>
                    ))}
                  </div>
                </div>
                <ProviderBadge state={data.geo} label="ip-api.com" />
                <ProviderBadge state={data.tor} label="Tor Project" />
                <ProviderBadge state={data.blacklist} label="Spamhaus ZEN" />
                {data.blacklist?.status === "ok" && (
                  <p className={data.blacklist.data.listed ? "text-red-300 text-xs" : "text-emerald-300 text-xs"}>
                    {data.blacklist.data.listed ? "⚠ Listed on Spamhaus ZEN blacklist" : "Not listed on Spamhaus ZEN"}
                  </p>
                )}
                <p className="text-xs text-slate-500">
                  Free sources only give anonymization/hosting/CVE signals, not an aggregated
                  malicious-verdict score from a paid threat-intel provider.
                </p>
              </div>
            );
          })()}
        </motion.div>
      )}
    </div>
  );
}
