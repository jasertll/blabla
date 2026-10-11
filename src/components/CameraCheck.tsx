"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Camera, ShieldAlert, Loader2, AlertTriangle, FileDown, Pin, KeyRound, Radio } from "lucide-react";
import { analyzeCameraSignals, remediationAdvice } from "@/lib/cameraDetection";
import { credentialsForVendor } from "@/lib/cameraCredentials";
import { scoreCamera } from "@/lib/riskScore";
import type { IpLookupResult } from "@/lib/osintTypes";
import { buildCameraReport, openReport } from "@/lib/reportGenerator";
import { buildGraphFromIpScan } from "@/lib/intelligenceGraph";
import { useInvestigation } from "@/contexts/InvestigationContext";
import InvestigationHeader from "@/components/InvestigationHeader";

type CameraProbe = {
  target: string;
  http: { reachable: boolean; scheme: string | null; status: number | null; server: string | null; title: string | null };
  onvif: { reachable: boolean; status: number | null };
};

export default function CameraCheck() {
  const [ip, setIp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<IpLookupResult | null>(null);
  const [probe, setProbe] = useState<CameraProbe | null>(null);
  const [kevMatches, setKevMatches] = useState<string[]>([]);
  const { mergeGraph, addTimelineEvent, setToolAlert } = useInvestigation();

  async function scan() {
    if (!ip.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    setProbe(null);
    setKevMatches([]);
    try {
      const [res, probeRes] = await Promise.all([
        fetch(`/api/osint/ip?target=${encodeURIComponent(ip.trim())}`),
        fetch(`/api/osint/camera?target=${encodeURIComponent(ip.trim())}`),
      ]);
      const json: IpLookupResult = await res.json();
      setData(json);
      probeRes.json().then(setProbe).catch(() => setProbe(null));

      const internetdb = json.internetdb.status === "ok" ? json.internetdb.data : null;
      const vulns = internetdb?.vulns ?? [];
      let matchedCves: string[] = [];
      if (vulns.length > 0) {
        try {
          const kevRes = await fetch(`/api/osint/kevcheck?cves=${encodeURIComponent(vulns.join(","))}`);
          const kevJson = await kevRes.json();
          matchedCves = (kevJson.matches ?? []).map((m: { cveID: string }) => m.cveID);
          setKevMatches(matchedCves);
        } catch {
          // Best-effort KEV cross-reference — scoring falls back to the
          // plain CVE-count signal without it.
        }
      }

      addTimelineEvent({ tool: "camera", label: "Camera/IoT scan", detail: ip.trim() });
      if (internetdb) {
        const signals = analyzeCameraSignals(internetdb);
        setToolAlert("camera", scoreCamera(internetdb, signals, matchedCves).label === "HIGH");
      }
    } catch {
      setError("Network error reaching the lookup API.");
    } finally {
      setLoading(false);
    }
  }

  function pinToGraph() {
    if (!data) return;
    const { nodes, edges } = buildGraphFromIpScan(ip.trim(), data);
    mergeGraph(nodes, edges);
    addTimelineEvent({ tool: "camera", label: "Camera IP pinned", detail: ip.trim() });
  }

  const internetdb = data?.internetdb.status === "ok" ? data.internetdb.data : null;
  const signals = internetdb ? analyzeCameraSignals(internetdb) : null;
  const hasVulns = (internetdb?.vulns.length ?? 0) > 0;

  return (
    <div className="glass-panel p-4 space-y-4">
      <div>
        <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
          <Camera className="h-4 w-4 text-accent" /> CCTV / IoT Camera Check
        </h2>
        <p className="text-xs text-slate-500">
          Only scan devices you own or are explicitly authorized to test. Reports open ports, CVEs
          cross-checked against CISA's real Known Exploited Vulnerabilities catalog, a passive
          management-interface banner/ONVIF probe, and known default credentials for the detected
          vendor — it never connects to, attempts login on, or displays a camera's feed.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && scan()}
          placeholder="Camera / DVR IP address"
          dir="ltr"
          className="flex-1 bg-panel/60 border border-border rounded-lg px-3 py-2 text-sm font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
        />
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={scan}
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

          {internetdb && signals && (() => {
            const score = scoreCamera(internetdb, signals, kevMatches);
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

          {internetdb && (
            <div className="flex justify-end gap-2">
              <button
                onClick={pinToGraph}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
              >
                <Pin className="h-3.5 w-3.5" /> Pin to Intelligence Graph
              </button>
              <button
                onClick={() => {
                  const html = buildCameraReport(
                    ip,
                    internetdb.ports,
                    internetdb.vulns,
                    signals?.isLikelyCamera ?? false,
                    signals?.vendorGuess ?? null,
                    remediationAdvice(hasVulns, signals?.criticalPorts ?? [])
                  );
                  openReport(html);
                }}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
              >
                <FileDown className="h-3.5 w-3.5" /> Export Report
              </button>
            </div>
          )}
          {data.internetdb.status !== "ok" && (
            <p className="text-xs text-slate-500">
              No open-port data available for this IP ({data.internetdb.status}).
            </p>
          )}

          {internetdb && (
            <>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] text-slate-500 mb-2">Open ports</p>
                <div className="flex flex-wrap gap-1.5">
                  {internetdb.ports.length === 0 && (
                    <span className="text-xs text-slate-500">None on record.</span>
                  )}
                  {internetdb.ports.map((p) => (
                    <span key={p} className="text-xs font-mono px-2 py-1 rounded bg-panel border border-border">
                      {p}
                    </span>
                  ))}
                </div>
              </div>

              {signals && signals.isLikelyCamera ? (
                <div className="rounded-lg border border-accent/40 bg-accent/10 p-3">
                  <p className="text-xs text-slate-100 font-semibold flex items-center gap-1.5 mb-2">
                    <Camera className="h-3.5 w-3.5" />
                    Looks like a camera/DVR device{signals.vendorGuess ? ` — likely ${signals.vendorGuess}` : ""}
                  </p>
                  <ul className="space-y-1">
                    {signals.matchedSignals.map((s, i) => (
                      <li key={i} className="text-[11px] text-slate-400 font-mono">{s}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  No camera/DVR fingerprint detected from this IP's open-port and metadata signature.
                </p>
              )}

              {hasVulns && (
                <div className="rounded-lg border border-severity-critical/50 severity-glow p-3">
                  <p className="text-xs text-red-300 font-semibold flex items-center gap-1.5 mb-2">
                    <ShieldAlert className="h-3.5 w-3.5" /> Known vulnerabilities
                  </p>
                  <ul className="space-y-1">
                    {internetdb.vulns.map((v) => (
                      <li key={v} className="text-xs font-mono text-red-300 flex items-center gap-1.5">
                        {v}
                        {kevMatches.includes(v) && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded border border-red-600/60 bg-red-950/60 text-red-300 font-sans">CISA KEV — actively exploited</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {probe && (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[11px] text-slate-500 mb-2 flex items-center gap-1.5">
                    <Radio className="h-3.5 w-3.5 text-accent" /> Management interface probe (passive — headers/title only, never the video feed)
                  </p>
                  <div className="space-y-1.5 text-xs">
                    {probe.http.reachable ? (
                      <>
                        <p className="text-slate-300">
                          Responds over {probe.http.scheme?.replace("://", "")} — HTTP {probe.http.status}
                          {probe.http.server && <span className="text-amber-300"> · Server: {probe.http.server}</span>}
                        </p>
                        {probe.http.title && <p className="text-slate-400 font-mono">Page title: "{probe.http.title}"</p>}
                      </>
                    ) : (
                      <p className="text-slate-500">No plain HTTP/HTTPS management page responded.</p>
                    )}
                    <p className={probe.onvif.reachable ? "text-amber-300" : "text-slate-500"}>
                      ONVIF device service (/onvif/device_service): {probe.onvif.reachable ? `responding (HTTP ${probe.onvif.status}) — standardized camera control API is exposed` : "not detected"}
                    </p>
                  </div>
                </div>
              )}

              {signals && signals.isLikelyCamera && (
                <div className="rounded-lg border border-amber-700/40 bg-amber-900/10 p-3">
                  <p className="text-[11px] text-amber-300 mb-2 flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" /> Known default credentials for this vendor family — check these were changed
                  </p>
                  <ul className="space-y-1">
                    {credentialsForVendor(signals.vendorGuess).map((c, i) => (
                      <li key={i} className="text-xs font-mono text-slate-300">
                        {c.username} / {c.password || "(blank)"}
                        {c.note && <span className="text-slate-500 font-sans"> — {c.note}</span>}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-slate-500 mt-2">Never attempted against this device — reference only, for you to verify have been changed.</p>
                </div>
              )}

              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] text-slate-500 mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> Remediation checklist
                </p>
                <ul className="space-y-1.5">
                  {remediationAdvice(hasVulns, signals?.criticalPorts ?? []).map((advice, i) => (
                    <li key={i} className="text-xs text-slate-300 flex gap-2">
                      <span className="text-accent-glow shrink-0">›</span> {advice}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </motion.div>
      )}
    </div>
  );
}
