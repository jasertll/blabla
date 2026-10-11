"use client";

import { useMemo, useState, type ReactElement } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen,
  FileText,
  HardDriveDownload,
  ChevronDown,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  Wrench,
  Terminal,
  Radar,
  ClipboardList,
  XCircle,
  Link2,
} from "lucide-react";
import { LOG_FORMAT_GUIDES, RECOVERY_GUIDES, analyzeLogText, type LogFinding } from "@/lib/logForensics";
import { MAGIC_SIGNATURES } from "@/lib/fileAnalysis";
import { SPECIALIST_GUIDES, INCIDENT_PLAYBOOKS } from "@/lib/securityPlaybooks";
import { analyzeUrl, type UrlFinding } from "@/lib/urlAnalysis";

type Severity2 = "danger" | "warning" | "info" | "safe";

const SEVERITY_STYLE: Record<Severity2, { border: string; bg: string; text: string; icon: ReactElement; label: string }> = {
  danger: { border: "border-red-700/60", bg: "bg-red-950/40", text: "text-red-300", icon: <ShieldAlert className="h-3.5 w-3.5" />, label: "DANGER" },
  warning: { border: "border-amber-700/60", bg: "bg-amber-950/30", text: "text-amber-300", icon: <AlertTriangle className="h-3.5 w-3.5" />, label: "WARNING" },
  info: { border: "border-cyan-700/60", bg: "bg-cyan-950/30", text: "text-cyan-300", icon: <HelpCircle className="h-3.5 w-3.5" />, label: "INFO" },
  safe: { border: "border-emerald-700/60", bg: "bg-emerald-950/30", text: "text-emerald-300", icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "OK" },
};

const CATEGORY_COLOR: Record<string, string> = {
  Host: "#5eead4",
  Windows: "#60a5fa",
  Web: "#f59e0b",
  Network: "#fb7185",
  DNS: "#c4b5fd",
  URL: "#f472b6",
  SIEM: "#a78bfa",
  "Network Defense": "#fb7185",
  "Data Protection": "#34d399",
};

type Tab = "logs" | "analyzer" | "recovery" | "specialist" | "playbooks";

const SAMPLE_LOG = `Aug 15 03:14:21 web01 sshd[14213]: Failed password for invalid user admin from 203.0.113.9 port 51422 ssh2
Aug 15 03:14:23 web01 sshd[14213]: Failed password for invalid user admin from 203.0.113.9 port 51430 ssh2
Aug 15 03:14:25 web01 sshd[14213]: Failed password for invalid user admin from 203.0.113.9 port 51438 ssh2
Aug 15 03:14:41 web01 sshd[14219]: Accepted password for root from 203.0.113.9 port 51502 ssh2
Aug 15 03:15:02 web01 sudo:    root : TTY=pts/0 ; PWD=/root ; USER=root ; COMMAND=/bin/chmod +s /bin/bash`;

function LogFindingCard({ f }: { f: LogFinding }) {
  const s = SEVERITY_STYLE[f.severity];
  return (
    <div className={`rounded-lg border p-3 ${s.border} ${s.bg}`}>
      <div className={`flex items-center gap-1.5 text-[10px] font-bold tracking-wide ${s.text}`}>
        {s.icon} {s.label}
        {f.lines.length > 0 && <span className="text-slate-500 font-normal ml-1">— line{f.lines.length === 1 ? "" : "s"} {f.lines.slice(0, 6).join(", ")}{f.lines.length > 6 ? "…" : ""}</span>}
      </div>
      <p className="text-sm text-slate-100 font-medium mt-1">{f.title}</p>
      <p className="text-xs text-slate-300 mt-1">{f.summary}</p>
      <p className="text-[11px] text-slate-500 mt-1.5"><span className="text-slate-400">Why it matters:</span> {f.explanation}</p>
      <p className="text-[11px] text-slate-400 mt-1"><span className="text-slate-500">Recommended:</span> {f.recommendation}</p>
    </div>
  );
}

function UrlFindingCard({ f }: { f: UrlFinding }) {
  const s = SEVERITY_STYLE[f.severity];
  return (
    <div className={`rounded-lg border p-3 ${s.border} ${s.bg}`}>
      <div className={`flex items-center gap-1.5 text-[10px] font-bold tracking-wide ${s.text}`}>
        {s.icon} {s.label}
      </div>
      <p className="text-sm text-slate-100 font-medium mt-1">{f.title}</p>
      <p className="text-xs text-slate-300 mt-1">{f.summary}</p>
      <p className="text-[11px] text-slate-500 mt-1.5"><span className="text-slate-400">Why it matters:</span> {f.explanation}</p>
      <p className="text-[11px] text-slate-400 mt-1"><span className="text-slate-500">Recommended:</span> {f.recommendation}</p>
    </div>
  );
}

function LogGuideCard({ id, expanded, onToggle }: { id: string; expanded: boolean; onToggle: () => void }) {
  const guide = LOG_FORMAT_GUIDES.find((g) => g.id === id)!;
  const color = CATEGORY_COLOR[guide.category] ?? "#9333EA";
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-3 px-3.5 py-3 hover:bg-surface-elevated/60 transition-colors text-left">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ color, background: `${color}22`, border: `1px solid ${color}55` }}>
            {guide.category}
          </span>
          <span className="text-sm text-slate-100 font-medium truncate">{guide.name}</span>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-3.5 pb-4 space-y-3 border-t border-border/60 pt-3">
              <p className="text-xs text-slate-400 leading-relaxed">{guide.description}</p>

              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1 flex items-center gap-1"><Terminal className="h-3 w-3" /> Example</p>
                <pre className="text-[10.5px] font-mono text-emerald-300/90 bg-[#05040a] border border-border rounded-lg p-2.5 overflow-x-auto whitespace-pre">{guide.example}</pre>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1">Field guide</p>
                <div className="space-y-1">
                  {guide.fields.map((f) => (
                    <p key={f.field} className="text-[11px] text-slate-400"><span className="text-slate-200 font-medium">{f.field}:</span> {f.meaning}</p>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1">Red flags</p>
                <div className="space-y-1.5">
                  {guide.redFlags.map((r, i) => (
                    <div key={i} className="rounded-md border border-red-900/40 bg-red-950/20 px-2.5 py-1.5">
                      <p className="text-[11px] text-red-300 font-medium">{r.pattern}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{r.why}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1 flex items-center gap-1"><Lightbulb className="h-3 w-3" /> Analyst tips</p>
                <ul className="space-y-1">
                  {guide.tips.map((t, i) => (
                    <li key={i} className="text-[11px] text-slate-400 flex gap-1.5"><span className="text-accent shrink-0">›</span>{t}</li>
                  ))}
                </ul>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RecoveryGuideCard({ id, expanded, onToggle }: { id: string; expanded: boolean; onToggle: () => void }) {
  const guide = RECOVERY_GUIDES.find((g) => g.id === id)!;
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-3 px-3.5 py-3 hover:bg-surface-elevated/60 transition-colors text-left">
        <span className="text-sm text-slate-100 font-medium">{guide.title}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-3.5 pb-4 space-y-3 border-t border-border/60 pt-3">
              <p className="text-xs text-slate-400 leading-relaxed">{guide.summary}</p>

              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1">Process</p>
                <ol className="space-y-1.5">
                  {guide.steps.map((s, i) => (
                    <li key={i} className="text-[11px] text-slate-400 flex gap-2">
                      <span className="shrink-0 h-4 w-4 rounded-full bg-accent/20 text-accent-glow text-[9px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                      {s}
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1 flex items-center gap-1"><Wrench className="h-3 w-3" /> Real tools</p>
                <div className="space-y-1.5">
                  {guide.tools.map((t) => (
                    <p key={t.name} className="text-[11px] text-slate-400"><span className="text-slate-200 font-medium">{t.name}:</span> {t.note}</p>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1 flex items-center gap-1"><Lightbulb className="h-3 w-3" /> Tips</p>
                <ul className="space-y-1">
                  {guide.tips.map((t, i) => (
                    <li key={i} className="text-[11px] text-slate-400 flex gap-1.5"><span className="text-accent shrink-0">›</span>{t}</li>
                  ))}
                </ul>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SpecialistGuideCard({ id, expanded, onToggle }: { id: string; expanded: boolean; onToggle: () => void }) {
  const guide = SPECIALIST_GUIDES.find((g) => g.id === id)!;
  const color = CATEGORY_COLOR[guide.category] ?? "#9333EA";
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-3 px-3.5 py-3 hover:bg-surface-elevated/60 transition-colors text-left">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ color, background: `${color}22`, border: `1px solid ${color}55` }}>
            {guide.category}
          </span>
          <span className="text-sm text-slate-100 font-medium truncate">{guide.title}</span>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-3.5 pb-4 space-y-3 border-t border-border/60 pt-3">
              <p className="text-xs text-slate-400 leading-relaxed">{guide.summary}</p>

              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1">Key concepts</p>
                <div className="space-y-1">
                  {guide.keyConcepts.map((c) => (
                    <p key={c.term} className="text-[11px] text-slate-400"><span className="text-slate-200 font-medium">{c.term}:</span> {c.meaning}</p>
                  ))}
                </div>
              </div>

              {guide.example && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1 flex items-center gap-1"><Terminal className="h-3 w-3" /> {guide.example.label}</p>
                  <pre className="text-[10.5px] font-mono text-emerald-300/90 bg-[#05040a] border border-border rounded-lg p-2.5 overflow-x-auto whitespace-pre">{guide.example.code}</pre>
                </div>
              )}

              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Best practices</p>
                <ul className="space-y-1">
                  {guide.bestPractices.map((t, i) => (
                    <li key={i} className="text-[11px] text-emerald-300/90 flex gap-1.5"><span className="text-emerald-500 shrink-0">›</span>{t}</li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1 flex items-center gap-1"><XCircle className="h-3 w-3" /> Common mistakes</p>
                <div className="space-y-1.5">
                  {guide.commonMistakes.map((m, i) => (
                    <div key={i} className="rounded-md border border-red-900/40 bg-red-950/20 px-2.5 py-1.5">
                      <p className="text-[11px] text-red-300 font-medium">{m.mistake}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">→ {m.consequence}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1 flex items-center gap-1"><Lightbulb className="h-3 w-3" /> Tips</p>
                <ul className="space-y-1">
                  {guide.tips.map((t, i) => (
                    <li key={i} className="text-[11px] text-slate-400 flex gap-1.5"><span className="text-accent shrink-0">›</span>{t}</li>
                  ))}
                </ul>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PlaybookStepList({ title, steps }: { title: string; steps: { step: string; detail?: string }[] }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1">{title}</p>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="text-[11px] text-slate-400 flex gap-2">
            <span className="shrink-0 h-4 w-4 rounded-full bg-accent/20 text-accent-glow text-[9px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
            <span><span className="text-slate-300">{s.step}</span>{s.detail ? <span className="text-slate-500"> — {s.detail}</span> : null}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PlaybookCard({ id, expanded, onToggle }: { id: string; expanded: boolean; onToggle: () => void }) {
  const p = INCIDENT_PLAYBOOKS.find((x) => x.id === id)!;
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-3 px-3.5 py-3 hover:bg-surface-elevated/60 transition-colors text-left">
        <span className="text-sm text-slate-100 font-medium">{p.title}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-3.5 pb-4 space-y-3 border-t border-border/60 pt-3">
              <p className="text-xs text-slate-400 leading-relaxed">{p.scenario}</p>

              <PlaybookStepList title="Immediate actions" steps={p.immediateActions} />
              <PlaybookStepList title="Investigation steps" steps={p.investigationSteps} />
              <PlaybookStepList title="Recovery steps" steps={p.recoverySteps} />

              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1 flex items-center gap-1"><XCircle className="h-3 w-3" /> Common mistakes</p>
                <div className="space-y-1.5">
                  {p.commonMistakes.map((m, i) => (
                    <div key={i} className="rounded-md border border-red-900/40 bg-red-950/20 px-2.5 py-1.5">
                      <p className="text-[11px] text-red-300 font-medium">{m.mistake}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">→ {m.consequence}</p>
                    </div>
                  ))}
                </div>
              </div>

              {p.relatedTools.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1">Related tools in this app</p>
                  <p className="text-[11px] text-slate-400">{p.relatedTools.join(" · ")}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ForensicsLibrary() {
  const [tab, setTab] = useState<Tab>("logs");
  const [expandedLog, setExpandedLog] = useState<string | null>(LOG_FORMAT_GUIDES[0].id);
  const [expandedRecovery, setExpandedRecovery] = useState<string | null>(RECOVERY_GUIDES[0].id);
  const [expandedSpecialist, setExpandedSpecialist] = useState<string | null>(SPECIALIST_GUIDES[0].id);
  const [expandedPlaybook, setExpandedPlaybook] = useState<string | null>(INCIDENT_PLAYBOOKS[0].id);
  const [logText, setLogText] = useState("");
  const [result, setResult] = useState<ReturnType<typeof analyzeLogText> | null>(null);
  const [urlText, setUrlText] = useState("");
  const [urlResult, setUrlResult] = useState<ReturnType<typeof analyzeUrl> | null>(null);

  const photoSignatures = useMemo(
    () => MAGIC_SIGNATURES.filter((s) => s.mime.startsWith("image/") || s.mime.startsWith("application/pdf") || s.label.includes("ZIP / OOXML") || s.label.includes("OLE2")),
    []
  );

  function runAnalysis() {
    if (!logText.trim()) return;
    setResult(analyzeLogText(logText));
  }

  function runUrlAnalysis() {
    if (!urlText.trim()) return;
    setUrlResult(analyzeUrl(urlText));
  }

  return (
    <div className="glass-panel p-4 space-y-4">
      <div>
        <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-accent" /> Forensics & Incident Response Learning Library
        </h2>
        <p className="text-xs text-slate-500">
          Advanced-track material for reading real log formats, spotting genuine attack patterns in them,
          and recovering deleted files/photos and metadata — with a working, in-browser log analyzer, not
          just reading material.
        </p>
      </div>

      <div className="flex gap-1.5 border-b border-border pb-2.5">
        <button onClick={() => setTab("logs")} className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${tab === "logs" ? "border-accent/60 bg-accent/15 text-accent-glow" : "border-border text-slate-500 hover:text-slate-300 hover:border-border/80"}`}>
          <FileText className="h-3 w-3" /> Log Format Guides
        </button>
        <button onClick={() => setTab("analyzer")} className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${tab === "analyzer" ? "border-accent/60 bg-accent/15 text-accent-glow" : "border-border text-slate-500 hover:text-slate-300 hover:border-border/80"}`}>
          <Terminal className="h-3 w-3" /> Interactive Log Analyzer
        </button>
        <button onClick={() => setTab("recovery")} className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${tab === "recovery" ? "border-accent/60 bg-accent/15 text-accent-glow" : "border-border text-slate-500 hover:text-slate-300 hover:border-border/80"}`}>
          <HardDriveDownload className="h-3 w-3" /> Data & Photo Recovery
        </button>
        <button onClick={() => setTab("specialist")} className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${tab === "specialist" ? "border-accent/60 bg-accent/15 text-accent-glow" : "border-border text-slate-500 hover:text-slate-300 hover:border-border/80"}`}>
          <Radar className="h-3 w-3" /> SIEM, Firewall & DLP
        </button>
        <button onClick={() => setTab("playbooks")} className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${tab === "playbooks" ? "border-accent/60 bg-accent/15 text-accent-glow" : "border-border text-slate-500 hover:text-slate-300 hover:border-border/80"}`}>
          <ClipboardList className="h-3 w-3" /> Incident Playbooks
        </button>
      </div>

      {tab === "logs" && (
        <div className="space-y-2">
          {LOG_FORMAT_GUIDES.map((g) => (
            <LogGuideCard key={g.id} id={g.id} expanded={expandedLog === g.id} onToggle={() => setExpandedLog(expandedLog === g.id ? null : g.id)} />
          ))}
        </div>
      )}

      {tab === "analyzer" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Paste real log lines (syslog/auth.log, Apache/Nginx access log, a Windows Security export,
            firewall/netfilter, or DNS query log — auto-detected per line) and run the same class of
            pattern-matching a SOC analyst does by hand: brute-force bursts, SQLi/XSS/traversal, port
            scans, encoded PowerShell, and DNS tunneling. Runs entirely in your browser.
          </p>
          <textarea
            value={logText}
            onChange={(e) => setLogText(e.target.value)}
            placeholder="Paste log lines here…"
            rows={8}
            dir="ltr"
            className="w-full bg-panel/60 border border-border rounded-lg p-3 text-[11px] font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2">
            <motion.button whileTap={{ scale: 0.97 }} onClick={runAnalysis} disabled={!logText.trim()} className="text-xs px-3 py-1.5 rounded-md bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors">
              Analyze
            </motion.button>
            <button onClick={() => setLogText(SAMPLE_LOG)} className="text-[11px] px-3 py-1.5 rounded-md border border-border text-slate-400 hover:border-accent/50 hover:text-slate-200 transition-colors">
              Load a sample (SSH brute force)
            </button>
          </div>

          {result && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
              <div>
                <p className="text-[11px] text-slate-500 mb-2">Findings ({result.findings.length})</p>
                <div className="space-y-2">
                  {result.findings.map((f) => <LogFindingCard key={f.id} f={f} />)}
                </div>
              </div>
              <div>
                <p className="text-[11px] text-slate-500 mb-2">Parsed lines ({result.parsed.length})</p>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
                  <table className="w-full text-[10.5px]">
                    <thead className="bg-surface-elevated/60 sticky top-0">
                      <tr className="text-slate-500 uppercase tracking-wide">
                        <th className="text-left px-2 py-1.5">#</th>
                        <th className="text-left px-2 py-1.5">Format</th>
                        <th className="text-left px-2 py-1.5">Key fields</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.parsed.map((p) => (
                        <tr key={p.lineNumber} className="border-t border-border/50">
                          <td className="px-2 py-1 text-slate-500 font-mono">{p.lineNumber}</td>
                          <td className="px-2 py-1 text-slate-300">{p.format}</td>
                          <td className="px-2 py-1 text-slate-400 font-mono truncate max-w-[420px]">
                            {Object.entries(p.fields).slice(0, 4).map(([k, v]) => `${k}=${v}`).join("  ") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          <div className="border-t border-border pt-4 space-y-3">
            <div>
              <p className="text-xs font-semibold text-slate-200 mb-1 flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5 text-accent" /> URL Analyzer</p>
              <p className="text-xs text-slate-500">
                Paste any URL to break it down into its real components and run it through structural
                phishing-pattern checks (IP-literal hosts, @ tricks, punycode/homograph risk, excessive
                subdomains, known shorteners, watch-list TLDs, hyphen-stuffing, missing HTTPS). This is
                structural analysis only — for the real DNS/TLS/WHOIS picture and subdomain enumeration
                on a domain, use the Domain & URL Scan tool.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={urlText}
                onChange={(e) => setUrlText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runUrlAnalysis()}
                placeholder="https://example.com/path?query=1"
                dir="ltr"
                className="flex-1 bg-panel/60 border border-border rounded-lg px-3 py-2 text-[11px] font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
              />
              <motion.button whileTap={{ scale: 0.97 }} onClick={runUrlAnalysis} disabled={!urlText.trim()} className="text-xs px-3 py-2 rounded-md bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors shrink-0">
                Analyze
              </motion.button>
              <button onClick={() => setUrlText("http://paypal.com@203.0.113.44:8080/wp-admin/setup-config.php")} className="text-[11px] px-3 py-2 rounded-md border border-border text-slate-400 hover:border-accent/50 hover:text-slate-200 transition-colors shrink-0">
                Load a sample
              </button>
            </div>

            {urlResult && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                {urlResult.components.length > 0 && (
                  <div className="rounded-lg border border-border overflow-hidden">
                    <table className="w-full text-[10.5px]">
                      <tbody>
                        {urlResult.components.map((c) => (
                          <tr key={c.label} className="border-t border-border/50 first:border-t-0">
                            <td className="px-2.5 py-1.5 text-slate-500 w-40">{c.label}</td>
                            <td className="px-2.5 py-1.5 text-slate-200 font-mono break-all">{c.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div>
                  <p className="text-[11px] text-slate-500 mb-2">Findings ({urlResult.findings.length})</p>
                  <div className="space-y-2">
                    {urlResult.findings.map((f) => <UrlFindingCard key={f.id} f={f} />)}
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      )}

      {tab === "recovery" && (
        <div className="space-y-4">
          <div className="space-y-2">
            {RECOVERY_GUIDES.map((g) => (
              <RecoveryGuideCard key={g.id} id={g.id} expanded={expandedRecovery === g.id} onToggle={() => setExpandedRecovery(expandedRecovery === g.id ? null : g.id)} />
            ))}
          </div>

          <div className="rounded-lg border border-border p-3.5">
            <p className="text-xs font-semibold text-slate-200 mb-1">Live reference: file signatures used for carving</p>
            <p className="text-[11px] text-slate-500 mb-3">
              The exact magic-byte table this app's File / Malware Inspector uses to identify a file's real
              type — the same technique a carver applies at scale across raw disk sectors. Filtered here to
              the types most relevant to photo/document recovery.
            </p>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-[10.5px]">
                <thead className="bg-surface-elevated/60 sticky top-0">
                  <tr className="text-slate-500 uppercase tracking-wide">
                    <th className="text-left px-2 py-1.5">Type</th>
                    <th className="text-left px-2 py-1.5">Magic bytes</th>
                    <th className="text-left px-2 py-1.5">Offset</th>
                    <th className="text-left px-2 py-1.5">Extensions</th>
                  </tr>
                </thead>
                <tbody>
                  {photoSignatures.map((s) => (
                    <tr key={s.label} className="border-t border-border/50">
                      <td className="px-2 py-1 text-slate-300">{s.label}</td>
                      <td className="px-2 py-1 text-emerald-300/90 font-mono">{s.bytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ")}</td>
                      <td className="px-2 py-1 text-slate-500 font-mono">{s.offset}</td>
                      <td className="px-2 py-1 text-slate-500 font-mono">{s.typicalExtensions.join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "specialist" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500 mb-1">
            Configuration and operational guides for the platforms a defender actually runs day to
            day — what to set up, what "good" looks like, and the specific mistakes that show up
            again and again in real deployments.
          </p>
          {SPECIALIST_GUIDES.map((g) => (
            <SpecialistGuideCard key={g.id} id={g.id} expanded={expandedSpecialist === g.id} onToggle={() => setExpandedSpecialist(expandedSpecialist === g.id ? null : g.id)} />
          ))}
        </div>
      )}

      {tab === "playbooks" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500 mb-1">
            Step-by-step incident playbooks — immediate actions, investigation steps, and recovery
            steps for the scenarios that come up most in real incident response, plus a running list
            of mistakes that undermine an otherwise-good investigation.
          </p>
          {INCIDENT_PLAYBOOKS.map((p) => (
            <PlaybookCard key={p.id} id={p.id} expanded={expandedPlaybook === p.id} onToggle={() => setExpandedPlaybook(expandedPlaybook === p.id ? null : p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
