"use client";

import { useMemo, useRef, useState, type ReactElement } from "react";
import { motion } from "framer-motion";
import { Waves, Upload, AlertTriangle, Info, ShieldAlert, Loader2, KeyRound, Copy, Check } from "lucide-react";
import { parsePcap, looksLikePcapng } from "@/lib/pcap/parse";
import { decodeFrame, type DecodedPacket } from "@/lib/pcap/decode";
import { buildConversations, findFindings, harvestCredentials, type Conversation, type Finding, type Credential } from "@/lib/pcap/analyze";
import { useInvestigation } from "@/contexts/InvestigationContext";

type Result = {
  fileName: string;
  totalFrames: number;
  decodedFrames: number;
  linkType: number;
  duration: number;
  protocolCounts: Record<string, number>;
  conversations: Conversation[];
  findings: Finding[];
  credentials: Credential[];
};

const SEVERITY_STYLE: Record<Finding["severity"], { border: string; bg: string; icon: ReactElement; label: string }> = {
  high: { border: "border-red-500/40", bg: "bg-red-500/10", icon: <ShieldAlert className="h-3.5 w-3.5 text-red-300" />, label: "text-red-300" },
  medium: { border: "border-amber-500/40", bg: "bg-amber-500/10", icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />, label: "text-amber-300" },
  info: { border: "border-border", bg: "bg-surface-elevated", icon: <Info className="h-3.5 w-3.5 text-slate-400" />, label: "text-slate-400" },
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function CredentialsPanel({ credentials }: { credentials: Credential[] }) {
  const [copied, setCopied] = useState(false);

  async function copyAll() {
    const lines = credentials.map(
      (c) => `${c.protocol}\t${c.username ?? ""}\t${c.password ?? ""}\t${c.endpoint}`
    );
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard permission denied — silently ignore, the panel is still readable */
    }
  }

  return (
    <div className="glass-panel p-4 space-y-2 border border-red-500/30">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-semibold text-sm text-slate-100 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-red-300" /> Credentials &amp; Usernames
          <span className="text-red-300 font-normal">({credentials.length})</span>
        </h3>
        <button
          onClick={copyAll}
          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border border-border text-slate-400 hover:border-accent/50 hover:text-slate-200 transition-colors"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy all"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 border-b border-border">
              <th className="py-1.5 pr-3">Protocol</th>
              <th className="py-1.5 pr-3">Username</th>
              <th className="py-1.5 pr-3">Password</th>
              <th className="py-1.5">Endpoint</th>
            </tr>
          </thead>
          <tbody>
            {credentials.map((c, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="py-1.5 pr-3 text-slate-300">{c.protocol}</td>
                <td className="py-1.5 pr-3 font-mono text-slate-200 break-all">{c.username ?? "—"}</td>
                <td className="py-1.5 pr-3 font-mono text-red-300 break-all">{c.password ?? "—"}</td>
                <td className="py-1.5 font-mono text-slate-500 break-all">{c.endpoint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-600">
        كل هاي طلعت من نص واضح (plaintext) بالالتقاط — ما في فك تشفير. NTLM/Negotiate بتنعرض كـ
        "handshake لوحظ" بدون يوزر/باسورد لأنها بايناري مش نص.
      </p>
    </div>
  );
}

export default function PcapAnalyzer() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { incrementSessionCount, addTimelineEvent } = useInvestigation();

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      if (looksLikePcapng(buf)) {
        setError("This is a .pcapng capture — only classic .pcap (libpcap) format is supported right now. Most tools (Wireshark, tcpdump) can export/save as classic .pcap.");
        return;
      }
      const pcap = parsePcap(buf);
      const decoded: DecodedPacket[] = [];
      for (const pkt of pcap.packets) {
        const d = decodeFrame(pcap.linkType, pkt.data, pkt.timestamp);
        if (d) decoded.push(d);
      }
      const protocolCounts: Record<string, number> = {};
      for (const d of decoded) protocolCounts[d.protocol] = (protocolCounts[d.protocol] ?? 0) + 1;

      const timestamps = pcap.packets.map((p) => p.timestamp);
      const duration = timestamps.length ? Math.max(...timestamps) - Math.min(...timestamps) : 0;

      const conversations = buildConversations(decoded);
      const findings = findFindings(decoded);
      const credentials = harvestCredentials(decoded);

      setResult({
        fileName: file.name,
        totalFrames: pcap.packets.length,
        decodedFrames: decoded.length,
        linkType: pcap.linkType,
        duration,
        protocolCounts,
        conversations,
        findings,
        credentials,
      });
      incrementSessionCount();
      addTimelineEvent({
        tool: "pcap",
        label: "PCAP capture analyzed",
        detail: `${file.name} — ${pcap.packets.length} frames, ${findings.length} finding(s), ${credentials.length} credential(s)`,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Couldn't parse this file.");
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  const topConversations = useMemo(() => result?.conversations.slice(0, 25) ?? [], [result]);

  return (
    <div className="space-y-4">
      <div className="glass-panel p-4 space-y-4">
        <div>
          <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
            <Waves className="h-4 w-4 text-accent" /> PCAP Network Analyzer
          </h2>
          <p className="text-xs text-slate-500 max-w-xl">
            Parses a classic .pcap capture entirely in your browser — nothing is uploaded anywhere.
            Builds a conversation list and flags concrete, evidence-backed issues: plaintext
            credentials, unencrypted legacy protocols, possible DNS tunneling, possible port scans.
          </p>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="border border-dashed border-border rounded-lg py-8 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-accent/50 transition-colors"
        >
          {loading ? (
            <Loader2 className="h-5 w-5 text-accent animate-spin" />
          ) : (
            <Upload className="h-5 w-5 text-slate-500" />
          )}
          <p className="text-xs text-slate-400">
            {loading ? "جارٍ التحليل…" : "اسحب ملف .pcap هون أو اضغط للاختيار"}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".pcap"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
        </div>

        {error && (
          <p className="text-xs text-red-300 leading-relaxed">{error}</p>
        )}
      </div>

      {result && !loading && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="glass-panel p-4">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Frames</p>
                <p className="text-lg font-display font-bold text-slate-100">{result.totalFrames}</p>
                {result.decodedFrames < result.totalFrames && (
                  <p className="text-[10px] text-slate-600">{result.decodedFrames} decoded</p>
                )}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Duration</p>
                <p className="text-lg font-display font-bold text-slate-100">{result.duration.toFixed(1)}s</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Conversations</p>
                <p className="text-lg font-display font-bold text-slate-100">{result.conversations.length}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Findings</p>
                <p className={`text-lg font-display font-bold ${result.findings.some((f) => f.severity === "high") ? "text-red-300" : "text-slate-100"}`}>
                  {result.findings.length}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Credentials</p>
                <p className={`text-lg font-display font-bold ${result.credentials.length > 0 ? "text-red-300" : "text-slate-100"}`}>
                  {result.credentials.length}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {Object.entries(result.protocolCounts).map(([proto, count]) => (
                <span key={proto} className="text-[10px] px-2 py-0.5 rounded-full border border-border text-slate-400">
                  {proto} · {count}
                </span>
              ))}
            </div>
          </div>

          {result.credentials.length > 0 && <CredentialsPanel credentials={result.credentials} />}

          {result.findings.length > 0 && (
            <div className="glass-panel p-4 space-y-2">
              <h3 className="font-display font-semibold text-sm text-slate-100">Findings</h3>
              <div className="space-y-2">
                {result.findings.map((f, i) => {
                  const s = SEVERITY_STYLE[f.severity];
                  return (
                    <div key={i} className={`rounded-lg border ${s.border} ${s.bg} p-3 text-xs`}>
                      <p className={`font-semibold flex items-center gap-1.5 ${s.label}`}>
                        {s.icon} {f.title}
                      </p>
                      <p className="text-slate-400 mt-1 leading-relaxed">{f.detail}</p>
                      <p className="text-slate-600 mt-1.5 font-mono text-[11px] break-all">{f.evidence}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="glass-panel p-4 space-y-2">
            <h3 className="font-display font-semibold text-sm text-slate-100">
              Top conversations {result.conversations.length > 25 && <span className="text-slate-600 font-normal">(top 25 by bytes)</span>}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 border-b border-border">
                    <th className="py-1.5 pr-3">Protocol</th>
                    <th className="py-1.5 pr-3">A</th>
                    <th className="py-1.5 pr-3">B</th>
                    <th className="py-1.5 pr-3">App</th>
                    <th className="py-1.5 pr-3">Packets</th>
                    <th className="py-1.5">Bytes</th>
                  </tr>
                </thead>
                <tbody>
                  {topConversations.map((c) => (
                    <tr key={c.key} className="border-b border-border/50 text-slate-300">
                      <td className="py-1.5 pr-3 font-mono">{c.protocol}</td>
                      <td className="py-1.5 pr-3 font-mono">{c.a}</td>
                      <td className="py-1.5 pr-3 font-mono">{c.b}</td>
                      <td className="py-1.5 pr-3">{c.appProtocol ?? "—"}</td>
                      <td className="py-1.5 pr-3">{c.packets}</td>
                      <td className="py-1.5">{fmtBytes(c.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {topConversations.length === 0 && (
                <p className="text-xs text-slate-600 text-center py-6">No IP conversations decoded from this capture.</p>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
