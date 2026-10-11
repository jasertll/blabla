"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Globe2, Loader2, CheckCircle2, XCircle, ArrowRight, FileDown, AlertTriangle } from "lucide-react";
import { useInvestigation } from "@/contexts/InvestigationContext";
import { buildWebAppReport, openReport } from "@/lib/reportGenerator";
import { extractHostname } from "@/lib/extractHostname";
import { buildGraphFromWebAppScan } from "@/lib/intelligenceGraph";
import { scoreWebApp } from "@/lib/riskScore";
import type { CspAnalysis } from "@/lib/cspAnalysis";
import type { CookieFinding } from "@/lib/cookieAnalysis";
import type { CorsAnalysis } from "@/lib/corsAnalysis";
import InvestigationHeader from "@/components/InvestigationHeader";

type HeaderCheck = {
  header: string;
  present: boolean;
  value: string | null;
  severity: "critical" | "recommended" | "info";
  note: string;
};

type WebAppResult = {
  target: string;
  finalUrl: string | null;
  headerScan: { status: "ok" | "error"; message?: string; grade?: string; score?: number; checks?: HeaderCheck[] };
  subdomains: { status: "ok" | "error" | "not_found"; message?: string; list?: string[] };
  owasp: {
    weakTls: boolean;
    tlsProtocol: string | null;
    serverVersionDisclosed: boolean;
    versionHeaders: string[];
    exposedFiles: { path: string; exposed: boolean; status: number | null }[];
    missingSri: boolean;
  } | null;
  csp: CspAnalysis | null;
  cookies: CookieFinding[];
  cors: CorsAnalysis | null;
};

const GRADE_COLOR: Record<string, string> = {
  A: "text-emerald-400 border-emerald-500/50 bg-emerald-900/20",
  B: "text-emerald-300 border-emerald-500/40 bg-emerald-900/10",
  C: "text-amber-300 border-amber-500/40 bg-amber-900/10",
  D: "text-orange-300 border-orange-500/40 bg-orange-900/10",
  F: "text-red-300 border-red-500/50 bg-red-900/20",
};

export default function WebAppScan() {
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WebAppResult | null>(null);
  const { runLookup, setActiveTool, mergeGraph, setToolAlert, addTimelineEvent } = useInvestigation();

  async function scan() {
    if (!domain.trim()) return;
    const hostname = extractHostname(domain);
    if (!hostname) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/osint/webapp?target=${encodeURIComponent(hostname)}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Scan failed.");
      } else {
        setData(json);
        const { nodes, edges } = buildGraphFromWebAppScan(hostname, json);
        mergeGraph(nodes, edges);
        addTimelineEvent({ tool: "webapp", label: "Web app security scan", detail: hostname });
        setToolAlert("webapp", scoreWebApp(json).label === "HIGH");
      }
    } catch {
      setError("Network error reaching the scan API.");
    } finally {
      setLoading(false);
    }
  }

  function checkSubdomain(sub: string) {
    setActiveTool("overview");
    runLookup(sub);
  }

  return (
    <div className="glass-panel p-4 space-y-4">
      <div>
        <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
          <Globe2 className="h-4 w-4 text-accent" /> Web App Security Scan
        </h2>
        <p className="text-xs text-slate-500">
          Passive checks only — security headers, real CSP directive-content analysis, session-cookie
          flag checks, a CORS-reflection probe, TLS handshake, common exposed-file paths, and public
          Certificate Transparency logs. Covers OWASP Top 10 categories detectable without sending
          attack payloads. Injection, full Broken Access Control, SSRF, and Auth Failures require
          active exploitation attempts to confirm — deliberately not done here.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && scan()}
          placeholder="example.com or https://example.com/page"
          dir="ltr"
          className="flex-1 bg-panel/60 border border-border rounded-lg px-3 py-2 text-sm font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
        />
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={scan}
          disabled={loading || !domain.trim()}
          className="text-xs px-3 py-2 rounded-md bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Scan"}
        </motion.button>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      {data && !loading && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 text-sm">
          <InvestigationHeader target={extractHostname(domain)} />
          <div className="flex justify-end">
            <button
              onClick={() => openReport(buildWebAppReport(extractHostname(domain), data))}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
            >
              <FileDown className="h-3.5 w-3.5" /> Export Report
            </button>
          </div>

          {(() => {
            const score = scoreWebApp(data);
            const riskColor = score.label === "HIGH" ? "text-red-300 border-red-700/40 bg-red-900/20" : score.label === "MEDIUM" ? "text-amber-300 border-amber-700/40 bg-amber-900/20" : "text-emerald-300 border-emerald-700/40 bg-emerald-900/20";
            return (
              <div className={`rounded-lg border p-3 ${riskColor}`}>
                <div className="flex items-center gap-3 mb-1">
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
            );
          })()}

          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] text-slate-500">Security headers</p>
              {data.headerScan.status === "ok" && data.headerScan.grade && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded border ${GRADE_COLOR[data.headerScan.grade]}`}>
                  Grade {data.headerScan.grade} · {data.headerScan.score}%
                </span>
              )}
            </div>
            {data.headerScan.status === "error" && (
              <p className="text-xs text-slate-500">{data.headerScan.message}</p>
            )}
            {data.headerScan.checks && (
              <ul className="space-y-1.5">
                {data.headerScan.checks.map((c) => (
                  <li key={c.header} className="flex items-start gap-2 text-xs">
                    {c.present ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${c.severity === "critical" ? "text-red-400" : "text-amber-400"}`} />
                    )}
                    <div>
                      <span className="font-mono text-slate-300">{c.header}</span>
                      {!c.present && <p className="text-slate-500 text-[11px]">{c.note}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.owasp && (
            <div className="rounded-lg border border-border p-3">
              <p className="text-[11px] text-slate-500 mb-2">OWASP Top 10 — Passive Coverage</p>
              <ul className="space-y-1.5">
                <li className="flex items-center gap-2 text-xs">
                  {data.owasp.weakTls ? <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                  Cryptographic Failures — TLS protocol {data.owasp.tlsProtocol ? `(${data.owasp.tlsProtocol})` : "(unknown)"}
                </li>
                <li className="flex items-center gap-2 text-xs">
                  {data.owasp.exposedFiles.some((f) => f.exposed) ? <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                  Security Misconfiguration — sensitive file exposure
                </li>
                <li className="flex items-center gap-2 text-xs">
                  {data.owasp.serverVersionDisclosed ? <XCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                  Vulnerable/Outdated Components — server version disclosure
                </li>
                <li className="flex items-center gap-2 text-xs">
                  {data.owasp.missingSri ? <XCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                  Software/Data Integrity — Subresource Integrity on external scripts
                </li>
                {data.cors?.tested && (
                  <li className="flex items-center gap-2 text-xs">
                    {data.cors.tone === "bad" ? <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" /> : data.cors.tone === "warn" ? <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                    Broken Access Control — passive CORS-reflection probe (not full access-control testing)
                  </li>
                )}
              </ul>
              {data.owasp.exposedFiles.some((f) => f.exposed) && (
                <div className="mt-2 pt-2 border-t border-border space-y-1">
                  {data.owasp.exposedFiles.filter((f) => f.exposed).map((f) => (
                    <p key={f.path} className="text-xs text-red-300 font-mono">{f.path} → HTTP {f.status}</p>
                  ))}
                </div>
              )}
              {data.owasp.versionHeaders.length > 0 && (
                <p className="text-xs text-amber-300/90 mt-2 font-mono">{data.owasp.versionHeaders.join(" · ")}</p>
              )}
              <p className="text-[11px] text-slate-500 mt-2">
                Injection, full Broken Access Control, SSRF, and Auth Failures need active test payloads
                to confirm — not performed here by design (see the tool description above).
              </p>
            </div>
          )}

          {data.csp && (
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] text-slate-500">Content Security Policy</p>
                {data.csp.found ? (
                  <span className={`text-[10px] px-2 py-0.5 rounded border ${data.csp.tone === "bad" ? "border-red-700/50 text-red-300" : data.csp.tone === "warn" ? "border-amber-700/50 text-amber-300" : "border-emerald-700/50 text-emerald-300"}`}>
                    {data.csp.issues.length} issue{data.csp.issues.length === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded border border-red-700/50 text-red-300">not found</span>
                )}
              </div>
              <p className={`text-xs mb-1.5 ${data.csp.tone === "bad" ? "text-red-300" : data.csp.tone === "warn" ? "text-amber-300" : "text-emerald-300"}`}>{data.csp.summary}</p>
              {data.csp.issues.length > 0 && (
                <ul className="space-y-1 mt-1.5 pt-1.5 border-t border-border">
                  {data.csp.issues.map((iss, i) => (
                    <li key={i} className="text-[11px] text-slate-400">
                      <span className={`font-mono ${iss.severity === "high" ? "text-red-300" : "text-amber-300"}`}>{iss.directive}</span>: {iss.problem}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {data.cookies && data.cookies.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <p className="text-[11px] text-slate-500 mb-2">Cookies ({data.cookies.length})</p>
              <div className="space-y-1.5">
                {data.cookies.map((c, i) => (
                  <div key={i} className="text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-300">{c.name}</span>
                      {c.looksLikeSession && <span className="text-[9px] px-1.5 py-0.5 rounded border border-accent/40 text-accent-glow">session-like</span>}
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border ${c.secure ? "border-emerald-700/50 text-emerald-300" : "border-slate-700 text-slate-500"}`}>Secure</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border ${c.httpOnly ? "border-emerald-700/50 text-emerald-300" : "border-slate-700 text-slate-500"}`}>HttpOnly</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border ${c.sameSite ? "border-emerald-700/50 text-emerald-300" : "border-slate-700 text-slate-500"}`}>SameSite{c.sameSite ? `=${c.sameSite}` : ""}</span>
                    </div>
                    {c.issues.map((iss, j) => (
                      <p key={j} className="text-[11px] text-amber-300 mt-0.5 pl-1">⚠ {iss}</p>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] text-slate-500 mb-2">
              Subdomains {data.subdomains.list ? `(${data.subdomains.list.length})` : ""}
            </p>
            {data.subdomains.status === "not_found" && (
              <p className="text-xs text-slate-500">No subdomains found in Certificate Transparency logs.</p>
            )}
            {data.subdomains.status === "error" && (
              <p className="text-xs text-slate-500">{data.subdomains.message}</p>
            )}
            {data.subdomains.list && (
              <div className="max-h-56 overflow-y-auto space-y-1">
                {data.subdomains.list.map((sub) => (
                  <button
                    key={sub}
                    onClick={() => checkSubdomain(sub)}
                    className="flex items-center justify-between w-full text-left text-xs font-mono text-slate-300 hover:text-accent-glow px-2 py-1 rounded hover:bg-panel/60 transition-colors"
                  >
                    {sub}
                    <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
