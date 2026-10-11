"use client";

import { useState, type ReactElement } from "react";
import { motion } from "framer-motion";
import { Radar, Loader2, FileDown, ShieldCheck, ShieldAlert, ExternalLink, Camera } from "lucide-react";
import { scoreDomain, scoreIp, scoreWebApp, type TransparentScore } from "@/lib/riskScore";
import { buildDomainReport, buildIpReport, buildWebAppReport, openReport } from "@/lib/reportGenerator";
import { useInvestigation } from "@/contexts/InvestigationContext";
import { buildAttackSurfaceGraph } from "@/lib/ipAttackSurface";
import AttackSurfaceMap from "@/components/ipAnalyzer/AttackSurfaceMap";
import { analyzeCameraSignals } from "@/lib/cameraDetection";

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

type SectionState<T> = { loading: boolean; error: string | null; data: T | null };

function initSection<T>(): SectionState<T> {
  return { loading: false, error: null, data: null };
}

const LABEL_STYLE: Record<TransparentScore["label"], { border: string; bg: string; text: string; icon: ReactElement }> = {
  HIGH: { border: "border-red-500/40", bg: "bg-red-500/10", text: "text-red-300", icon: <ShieldAlert className="h-4 w-4" /> },
  MEDIUM: { border: "border-amber-500/40", bg: "bg-amber-500/10", text: "text-amber-300", icon: <ShieldAlert className="h-4 w-4" /> },
  LOW: { border: "border-emerald-500/40", bg: "bg-emerald-500/10", text: "text-emerald-300", icon: <ShieldCheck className="h-4 w-4" /> },
};

function ScoreCard({ title, score }: { title: string; score: TransparentScore }) {
  const s = LABEL_STYLE[score.label];
  return (
    <div className={`rounded-lg border p-3 ${s.border} ${s.bg}`}>
      <div className={`flex items-center gap-1.5 text-xs font-semibold ${s.text}`}>
        {s.icon} {title} — {score.label}
      </div>
      <p className="text-[11px] text-slate-500 mt-1">{score.total}/100</p>
      <div className="mt-1.5 space-y-0.5">
        {score.factors.slice(0, 3).map((f, i) => (
          <p key={i} className="text-[10px] text-slate-400">• {f.reason}</p>
        ))}
      </div>
    </div>
  );
}

export default function AttackSurfaceReport() {
  const [target, setTarget] = useState("");
  const [running, setRunning] = useState(false);
  const [resolvedIp, setResolvedIp] = useState<string | null>(null);
  const [domain, setDomain] = useState<SectionState<any>>(initSection());
  const [webapp, setWebapp] = useState<SectionState<any>>(initSection());
  const [ip, setIp] = useState<SectionState<any>>(initSection());
  const [certwatch, setCertwatch] = useState<SectionState<any>>(initSection());
  const [kevMatches, setKevMatches] = useState<string[]>([]);
  const { incrementSessionCount, addTimelineEvent } = useInvestigation();

  async function fetchJson(url: string): Promise<{ ok: boolean; data: any; message?: string }> {
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) return { ok: false, data: null, message: json.message ?? json.error ?? `HTTP ${res.status}` };
      return { ok: true, data: json };
    } catch {
      return { ok: false, data: null, message: "Network error." };
    }
  }

  // Cross-references any CVEs the resolved IP has against the real, full
  // CISA KEV catalog — same properly-scoped check used by IP Analyzer/
  // Domain Scan/Camera Check, so this report's "Overall" score doesn't
  // understate risk for a host with an actively-exploited CVE.
  async function fetchKevMatches(ipData: any): Promise<string[]> {
    const vulns: string[] = ipData?.internetdb?.status === "ok" ? ipData.internetdb.data.vulns : [];
    if (vulns.length === 0) return [];
    const r = await fetchJson(`/api/osint/kevcheck?cves=${encodeURIComponent(vulns.join(","))}`);
    return r.ok ? (r.data.matches ?? []).map((m: { cveID: string }) => m.cveID) : [];
  }

  async function run() {
    const t = target.trim().toLowerCase();
    if (!t) return;
    setRunning(true);
    setResolvedIp(null);
    setDomain(initSection());
    setWebapp(initSection());
    setIp(initSection());
    setCertwatch(initSection());
    setKevMatches([]);

    if (IP_RE.test(t)) {
      setIp({ loading: true, error: null, data: null });
      const r = await fetchJson(`/api/osint/ip?target=${encodeURIComponent(t)}`);
      setIp({ loading: false, error: r.ok ? null : r.message ?? "Failed", data: r.ok ? r.data : null });
      if (r.ok) fetchKevMatches(r.data).then(setKevMatches);
      setRunning(false);
      incrementSessionCount();
      addTimelineEvent({ tool: "surface", label: "Attack surface report", detail: `${t} (IP only)` });
      return;
    }

    if (!DOMAIN_RE.test(t)) {
      setDomain({ loading: false, error: "اكتب دومين صحيح أو عنوان IPv4.", data: null });
      setRunning(false);
      return;
    }

    setDomain({ loading: true, error: null, data: null });
    setWebapp({ loading: true, error: null, data: null });
    setCertwatch({ loading: true, error: null, data: null });

    const [domainRes, webappRes, certRes] = await Promise.all([
      fetchJson(`/api/osint/domain?target=${encodeURIComponent(t)}`),
      fetchJson(`/api/osint/webapp?target=${encodeURIComponent(t)}`),
      fetchJson(`/api/osint/certwatch?domain=${encodeURIComponent(t)}`),
    ]);

    setDomain({ loading: false, error: domainRes.ok ? null : domainRes.message ?? "Failed", data: domainRes.ok ? domainRes.data : null });
    setWebapp({ loading: false, error: webappRes.ok ? null : webappRes.message ?? "Failed", data: webappRes.ok ? webappRes.data : null });
    setCertwatch({ loading: false, error: certRes.ok ? null : certRes.message ?? "Failed", data: certRes.ok ? certRes.data : null });

    const a0 = domainRes.ok ? domainRes.data?.dns?.a?.[0] : null;
    if (a0) {
      setResolvedIp(a0);
      setIp({ loading: true, error: null, data: null });
      const ipRes = await fetchJson(`/api/osint/ip?target=${encodeURIComponent(a0)}`);
      setIp({ loading: false, error: ipRes.ok ? null : ipRes.message ?? "Failed", data: ipRes.ok ? ipRes.data : null });
      if (ipRes.ok) fetchKevMatches(ipRes.data).then(setKevMatches);
    }

    setRunning(false);
    incrementSessionCount();
    addTimelineEvent({ tool: "surface", label: "Attack surface report", detail: t });
  }

  const domainScore = domain.data ? scoreDomain(domain.data) : null;
  const ipScore = ip.data ? scoreIp(ip.data, kevMatches) : null;
  const webAppScore = webapp.data?.headerScan?.status === "ok" ? scoreWebApp(webapp.data) : null;
  const internetdb = ip.data?.internetdb?.status === "ok" ? ip.data.internetdb.data : null;
  const cameraSignals = internetdb ? analyzeCameraSignals(internetdb) : null;

  const anyHigh = domainScore?.label === "HIGH" || ipScore?.label === "HIGH" || webAppScore?.label === "HIGH";
  const anyMedium = domainScore?.label === "MEDIUM" || ipScore?.label === "MEDIUM" || webAppScore?.label === "MEDIUM";
  const overall: TransparentScore["label"] = anyHigh ? "HIGH" : anyMedium ? "MEDIUM" : domainScore || ipScore || webAppScore ? "LOW" : "LOW";
  const hasAnyData = !!(domain.data || ip.data || webapp.data);

  return (
    <div className="space-y-4">
      <div className="glass-panel p-4 space-y-4">
        <div>
          <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
            <Radar className="h-4 w-4 text-accent" /> Attack Surface Report
          </h2>
          <p className="text-xs text-slate-500 max-w-xl">
            يشغّل كل أدوات الفحص (دومين، سيرفر الويب، الـIP المرتبط، ومراقبة الشهادات) على هدف
            واحد بضغطة، ويلمّلك النتائج بمكان واحد بدل ما تفحص كل أداة لحالها.
          </p>
        </div>

        <div className="flex gap-2">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="example.com أو 203.0.113.10"
            dir="ltr"
            className="flex-1 bg-panel/60 border border-border rounded-lg px-3 py-2 text-sm font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
          />
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={run}
            disabled={running || !target.trim()}
            className="text-sm px-4 py-2 rounded-lg bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : "Scan"}
          </motion.button>
        </div>
        {domain.error && !domain.data && <p className="text-xs text-red-300">{domain.error}</p>}
      </div>

      {hasAnyData && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className={`glass-panel p-4 border ${LABEL_STYLE[overall].border} ${LABEL_STYLE[overall].bg}`}>
            <div className={`flex items-center gap-2.5 ${LABEL_STYLE[overall].text}`}>
              {LABEL_STYLE[overall].icon}
              <div>
                <p className="text-sm font-semibold">Overall attack surface: {overall}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {target.trim()} {resolvedIp && <>· resolves to <span className="font-mono">{resolvedIp}</span></>}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {domainScore && <ScoreCard title="Domain / DNS" score={domainScore} />}
            {ipScore && <ScoreCard title={`IP${resolvedIp ? ` (${resolvedIp})` : ""}`} score={ipScore} />}
            {webAppScore && <ScoreCard title="Web App Security" score={webAppScore} />}
          </div>

          {webapp.data?.headerScan?.status === "ok" && webapp.data.subdomains?.status === "ok" && webapp.data.subdomains.list?.length > 0 && (
            <p className="text-[11px] text-slate-500 -mt-2">{webapp.data.subdomains.list.length} subdomain(s) discovered via Certificate Transparency.</p>
          )}

          {cameraSignals?.isLikelyCamera && (
            <div className="glass-panel p-4 border border-accent/40 bg-accent/10">
              <h3 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-1.5">
                <Camera className="h-4 w-4" /> Camera/DVR device signature detected
              </h3>
              <p className="text-xs text-slate-300">
                This resolved IP fingerprints as a camera/DVR device{cameraSignals.vendorGuess ? ` (likely ${cameraSignals.vendorGuess})` : ""} — see the CCTV/IoT Camera Check tool for default-credential references and a management-interface probe.
              </p>
            </div>
          )}

          {ip.data && internetdb && (
            <div className="glass-panel p-4">
              <h3 className="font-display font-semibold text-sm text-slate-100 mb-2">Attack Surface Map</h3>
              {(() => {
                const { nodes, edges } = buildAttackSurfaceGraph(resolvedIp ?? target.trim(), ip.data, kevMatches);
                return <AttackSurfaceMap nodes={nodes} edges={edges} />;
              })()}
            </div>
          )}

          {(certwatch.data || certwatch.error) && (
            <div className="glass-panel p-4">
              <h3 className="font-display font-semibold text-sm text-slate-100 mb-2">Certificate Transparency</h3>
              {certwatch.data ? (
                <p className="text-xs text-slate-300">
                  {certwatch.data.certs?.length ?? 0} certificate(s) on record
                  {certwatch.data.watching ? " · already on your watchlist" : " · not being watched — add it from Certificate Watch"}
                </p>
              ) : (
                <p className="text-xs text-slate-500">crt.sh lookup failed: {certwatch.error} — try again in a moment or check the Certificate Watch tool directly.</p>
              )}
            </div>
          )}

          {ip.data?.internetdb?.status === "ok" && (
            <div className="glass-panel p-4">
              <h3 className="font-display font-semibold text-sm text-slate-100 mb-2">Open Ports & Known CVEs</h3>
              <p className="text-xs text-slate-300 font-mono">
                {ip.data.internetdb.data.ports.length > 0 ? ip.data.internetdb.data.ports.join(", ") : "no open ports reported"}
              </p>
              {ip.data.internetdb.data.vulns.length > 0 && (
                <p className="text-xs text-red-300 mt-1">{ip.data.internetdb.data.vulns.length} known CVE(s): {ip.data.internetdb.data.vulns.slice(0, 8).join(", ")}</p>
              )}
            </div>
          )}

          <div className="glass-panel p-4 space-y-2">
            <h3 className="font-display font-semibold text-sm text-slate-100">Full Reports</h3>
            <div className="flex flex-wrap gap-2">
              {domain.data && (
                <button
                  onClick={() => openReport(buildDomainReport(target.trim(), domain.data))}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
                >
                  <FileDown className="h-3.5 w-3.5" /> Domain report <ExternalLink className="h-3 w-3" />
                </button>
              )}
              {ip.data && (
                <button
                  onClick={() => openReport(buildIpReport(resolvedIp ?? target.trim(), ip.data))}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
                >
                  <FileDown className="h-3.5 w-3.5" /> IP report <ExternalLink className="h-3 w-3" />
                </button>
              )}
              {webapp.data && (
                <button
                  onClick={() => openReport(buildWebAppReport(target.trim(), webapp.data))}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
                >
                  <FileDown className="h-3.5 w-3.5" /> Web app report <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
