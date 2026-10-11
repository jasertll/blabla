"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { buildDomainAssessment } from "@/lib/intelligenceAssessment";
import { scoreDomain } from "@/lib/riskScore";
import { ShieldCheck, Loader2, FileDown, CheckCircle2, HelpCircle, AlertTriangle } from "lucide-react";
import { useInvestigation } from "@/contexts/InvestigationContext";
import { ProviderBadge, DomainAgeSignal } from "@/components/ResolvedIpPanel";
import { ResolvedIpPorts, ResolvedIpReputation, ResolvedIpAttackSurface } from "@/components/ResolvedIpPanel";
import { buildDomainReport, openReport } from "@/lib/reportGenerator";
import { buildGraphFromDomainScan } from "@/lib/intelligenceGraph";
import { analyzeSpf, analyzeDmarc } from "@/lib/emailAuthAnalysis";
import { flagSubdomains } from "@/lib/subdomainRisk";
import type { DomainLookupResult } from "@/lib/osintTypes";
import InvestigationHeader from "@/components/InvestigationHeader";

const TABS = ["Assessment", "Overview", "Attack Surface", "Open Ports", "Security Records", "Subdomains", "Reputation"] as const;
type Tab = (typeof TABS)[number];

export default function DomainScan() {
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DomainLookupResult | null>(null);
  const [tab, setTab] = useState<Tab>("Assessment");
  const { handoff, clearHandoff, incrementSessionCount, mergeGraph, setToolAlert, addTimelineEvent } = useInvestigation();

  async function scan(target: string) {
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/osint/domain?target=${encodeURIComponent(target.trim())}`);
      const json = await res.json();
      setData(json);
      incrementSessionCount();
      const { nodes, edges } = buildGraphFromDomainScan(target.trim(), json);
      mergeGraph(nodes, edges);
      addTimelineEvent({ tool: "domain", label: "Domain scan", detail: target.trim() });
      setToolAlert("domain", scoreDomain(json).label === "HIGH");
    } catch {
      setError("Network error reaching the lookup API.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (handoff?.tool === "domain") {
      setDomain(handoff.value);
      scan(handoff.value);
      clearHandoff();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  return (
    <div className="glass-panel p-4 space-y-4">
      <div>
        <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-accent" /> Domain & URL Scan
        </h2>
        <p className="text-xs text-slate-500">
          DNS, SPF/DMARC/CAA/DNSSEC, TLS certificate, WHOIS via RDAP, certificate-transparency
          subdomain discovery, and a domain-age risk signal — all keyless. Independent from the
          IP Analyzer next to it.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && scan(domain)}
          placeholder="e.g. example.com"
          dir="ltr"
          className="flex-1 bg-panel/60 border border-border rounded-lg px-3 py-2 text-sm font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
        />
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => scan(domain)}
          disabled={loading || !domain.trim()}
          className="text-xs px-3 py-2 rounded-md bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Scan"}
        </motion.button>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      {data && !loading && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 text-sm">
          <InvestigationHeader target={domain} />
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
              onClick={() => openReport(buildDomainReport(domain, data))}
              className="flex items-center gap-1 text-[11px] px-2 py-1 ml-2 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors shrink-0"
            >
              <FileDown className="h-3.5 w-3.5" /> Export Report
            </button>
          </div>

          {tab === "Assessment" && (() => {
            const assessment = buildDomainAssessment(domain, data);
            const score = scoreDomain(data);
            const riskColor = score.label === "HIGH" ? "text-red-300 border-red-700/40 bg-red-900/20" : score.label === "MEDIUM" ? "text-amber-300 border-amber-700/40 bg-amber-900/20" : "text-emerald-300 border-emerald-700/40 bg-emerald-900/20";
            return (
              <div className="space-y-4">
                <div className={`rounded-lg border p-3 ${riskColor}`}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl font-display font-bold">{score.total}/100</span>
                    <span className="text-xs font-bold">{score.label} RISK</span>
                    <span className="text-[11px] px-2.5 py-1 rounded-lg border border-border text-slate-400 ml-auto">{assessment.overallConfidence}</span>
                  </div>
                  <div className="space-y-1 pt-2 border-t border-current/20">
                    {score.factors.map((f, i) => (
                      <p key={i} className="text-[11px] text-slate-300">
                        <span className="font-mono font-bold">{f.points > 0 ? `+${f.points}` : "0"}</span> {f.reason}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
                  <p className="text-[11px] font-semibold text-slate-300 mb-1">WHY IT MATTERS</p>
                  <p className="text-xs text-slate-300 leading-relaxed">{assessment.whyItMatters}</p>
                </div>

                <div>
                  <p className="text-[11px] font-semibold text-slate-300 mb-1.5">WHAT WE KNOW</p>
                  <div className="space-y-1.5">
                    {assessment.whatWeKnow.map((f, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <p className="text-slate-300">{f.text} <span className="text-slate-500">— {f.confidence.toLowerCase()}, {f.source}</span></p>
                      </div>
                    ))}
                  </div>
                </div>

                {assessment.whatWeSuspect.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-slate-300 mb-1.5">WHAT WE SUSPECT</p>
                    <div className="space-y-1.5">
                      {assessment.whatWeSuspect.map((f, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                          <p className="text-slate-300">{f.text} <span className="text-slate-500">— {f.confidence.toLowerCase()}, {f.source}</span></p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-[11px] font-semibold text-slate-300 mb-1.5">NEXT INVESTIGATION STEPS</p>
                  <ul className="space-y-1">
                    {assessment.nextSteps.map((s, i) => (
                      <li key={i} className="text-xs text-slate-300 flex gap-2"><span className="text-accent-glow shrink-0">›</span>{s}</li>
                    ))}
                  </ul>
                </div>

                <div className="pt-2 border-t border-border">
                  <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                    <HelpCircle className="h-3 w-3" /> Sources: {assessment.sources.join(" · ")}
                  </p>
                </div>
              </div>
            );
          })()}

          {tab === "Overview" && (
            <div className="space-y-1.5 text-slate-300 font-mono text-xs">
              <p>A: {data.dns?.a?.join(", ") || "—"}</p>
              <p>AAAA: {data.dns?.aaaa?.join(", ") || "—"}</p>
              <p>CNAME: {data.dns?.cname?.join(", ") || "—"}</p>
              <p>MX: {data.dns?.mx?.map((m: any) => `${m.exchange} (${m.priority})`).join(", ") || "—"}</p>
              <p>NS: {data.dns?.ns?.join(", ") || "—"}</p>
              <div>
                <p className="text-slate-400">TXT:</p>
                {data.dns?.txt?.length ? (
                  <div className="space-y-0.5 mt-0.5">
                    {data.dns.txt.map((chunks: string[], i: number) => (
                      <p key={i} className="text-slate-300 break-all pl-3">{chunks.join("")}</p>
                    ))}
                  </div>
                ) : (
                  <span className="pl-3">—</span>
                )}
              </div>
            </div>
          )}

          {tab === "Attack Surface" && <ResolvedIpAttackSurface ip={data.dns?.a?.[0]} />}

          {tab === "Open Ports" && <ResolvedIpPorts ip={data.dns?.a?.[0]} />}

          {tab === "Security Records" && (() => {
            const spf = analyzeSpf(data.security?.spf ?? null);
            const dmarc = analyzeDmarc(data.security?.dmarc ?? null);
            const toneCls = (t: "good" | "warn" | "bad") => (t === "good" ? "text-emerald-300" : t === "warn" ? "text-amber-300" : "text-red-300");
            return (
            <div className="space-y-2">
              <p className="text-slate-300 font-mono text-xs break-all">SPF: {data.security?.spf ?? "not found"}</p>
              <p className={`text-xs ${toneCls(spf.tone)}`}>{spf.note}</p>
              {spf.overLookupLimit && <p className="text-xs text-red-300">⚠ {spf.lookupMechanisms} DNS-lookup mechanisms — exceeds RFC 7208's 10-lookup limit, which can cause SPF to fail open (permerror).</p>}
              <p className="text-slate-300 font-mono text-xs break-all mt-2">DMARC: {data.security?.dmarc ?? "not found"}</p>
              <p className={`text-xs ${toneCls(dmarc.tone)}`}>{dmarc.note}</p>
              {dmarc.found && !dmarc.hasAggregateReports && <p className="text-xs text-slate-500">No rua= aggregate-report address configured — the domain owner won't receive DMARC failure reports.</p>}
              <p className="text-slate-500 text-xs mt-2">{data.security?.dkimNote}</p>
              <div className="mt-3 pt-3 border-t border-border">
                <ProviderBadge state={data.ssl} label="TLS Certificate" />
                {data.ssl?.status === "ok" && (
                  <p className="text-xs text-slate-300 mt-1">
                    Issued by {data.ssl.data.issuer}, expires {new Date(data.ssl.data.validTo).toLocaleDateString()} ({data.ssl.data.daysUntilExpiry} days)
                  </p>
                )}
              </div>
              <div className="mt-3 pt-3 border-t border-border">
                <ProviderBadge state={data.whois} label="WHOIS (RDAP)" />
                {data.whois?.status === "ok" && (
                  <p className="text-xs text-slate-300 mt-1">
                    Registrar: {data.whois.data.registrar ?? "Unknown"} · Created: {data.whois.data.createdDate ?? "Unknown"}
                  </p>
                )}
              </div>

              <div className="mt-3 pt-3 border-t border-border">
                <ProviderBadge state={data.dnssec} label="DNSSEC (Cloudflare DoH)" />
                {data.dnssec?.status === "ok" && (
                  <p className="text-xs mt-1">
                    {data.dnssec.data.signed ? (
                      <span className={data.dnssec.data.validated ? "text-emerald-300" : "text-amber-300"}>
                        {data.dnssec.data.validated
                          ? "✓ DNSSEC signed and validated — the resolver confirmed the signature chain."
                          : "⚠ DNSKEY published, but not independently validated by the resolver."}
                      </span>
                    ) : (
                      <span className="text-slate-400">Not signed — this domain doesn't use DNSSEC.</span>
                    )}
                  </p>
                )}
              </div>

              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-[11px] text-slate-500 mb-1">CAA (who's allowed to issue TLS certs)</p>
                <ProviderBadge state={data.caa} label="DNS (CAA)" />
                {data.caa?.status === "ok" && (
                  <div className="space-y-0.5 mt-1">
                    {data.caa.data.records.map((r, i) => (
                      <p key={i} className="text-xs font-mono text-slate-300">
                        {r.critical ? "! " : ""}{r.tag}: {r.value}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-[11px] text-slate-500 mb-1">SOA (zone authority)</p>
                <ProviderBadge state={data.soa} label="DNS (SOA)" />
                {data.soa?.status === "ok" && (
                  <p className="text-xs font-mono text-slate-300 mt-1">
                    {data.soa.data.nsname} · serial {data.soa.data.serial} · refresh {data.soa.data.refresh}s
                  </p>
                )}
              </div>
            </div>
            );
          })()}

          {tab === "Subdomains" && (() => {
            const flagged = data.subdomains?.status === "ok" ? flagSubdomains(data.subdomains.data.items) : new Map();
            return (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-500">
                Every hostname that's ever appeared in a public TLS certificate for this domain,
                pulled from Certificate Transparency logs — including subdomains never linked from
                anywhere on the public web.
              </p>
              <ProviderBadge state={data.subdomains} label="crt.sh" />
              {data.subdomains?.status === "ok" && (
                <>
                  <p className="text-xs text-slate-400">
                    {data.subdomains.data.count} unique hostname{data.subdomains.data.count === 1 ? "" : "s"} found
                    {data.subdomains.data.truncated && ` (showing first ${data.subdomains.data.items.length})`}
                    {flagged.size > 0 && `, ${flagged.size} flagged as higher-value recon targets by name`}
                  </p>
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-[#0d0a18] p-2 space-y-0.5">
                    {data.subdomains.data.items.map((s) => {
                      const flags = flagged.get(s);
                      return (
                        <div key={s} className="flex items-center gap-1.5 flex-wrap">
                          <p className={`text-xs font-mono break-all ${flags ? "text-amber-300" : "text-slate-300"}`}>{s}</p>
                          {flags?.map((f: { keyword: string; reason: string }, i: number) => (
                            <span key={i} title={f.reason} className="text-[9px] px-1.5 py-0.5 rounded border border-amber-700/50 text-amber-300 font-sans">{f.keyword}</span>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            );
          })()}

          {tab === "Reputation" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border p-2.5">
                <p className="text-[11px] text-slate-500 mb-1">Domain age signal</p>
                <DomainAgeSignal createdDate={data.whois?.status === "ok" ? data.whois.data.createdDate : null} />
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <p className="text-[11px] text-slate-500 mb-1">Resolved IP signals</p>
                <ResolvedIpReputation ip={data.dns?.a?.[0]} />
              </div>
              <p className="text-[11px] text-slate-500">
                Free heuristic signals, not an aggregated malicious-verdict score.
              </p>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
