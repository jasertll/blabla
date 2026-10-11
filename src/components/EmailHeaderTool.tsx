"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Mail, ArrowRight, CheckCircle2, XCircle, HelpCircle, Upload, AlertTriangle, Pin } from "lucide-react";
import { useInvestigation } from "@/contexts/InvestigationContext";
import type { GraphNodeData, GraphEdgeData } from "@/lib/intelligenceGraph";
import { isPrivateOrReservedIp } from "@/lib/ipRanges";

type AuthResult = { mechanism: string; verdict: string; domain?: string } | null;

type Hop = { raw: string; ip: string | null; from: string | null; by: string | null; date: Date | null };

type Parsed = {
  from: string | null;
  to: string | null;
  replyTo: string | null;
  returnPath: string | null;
  subject: string | null;
  date: string | null;
  messageId: string | null;
  spf: AuthResult;
  dkim: AuthResult;
  dmarc: AuthResult;
  hops: Hop[];
  originatingIp: string | null;
  xOriginatingIp: string | null;
  dkimSigDomain: string | null;
  anomalies: string[];
};

function extractHeader(raw: string, name: string): string | null {
  const re = new RegExp(`^${name}:\\s*(.+(?:\\r?\\n[ \\t].+)*)`, "im");
  const match = raw.match(re);
  return match ? match[1].replace(/\r?\n[ \t]+/g, " ").trim() : null;
}

function parseAuthResults(raw: string): { spf: AuthResult; dkim: AuthResult; dmarc: AuthResult } {
  const header = extractHeader(raw, "Authentication-Results");
  const result: { spf: AuthResult; dkim: AuthResult; dmarc: AuthResult } = {
    spf: null,
    dkim: null,
    dmarc: null,
  };
  if (!header) return result;

  const spf = header.match(/spf=(\w+)/i);
  // DKIM's own d= (signing domain) tag right after dkim=<verdict> — the
  // field that actually determines DKIM *alignment* with DMARC, distinct
  // from just "did some signature somewhere verify."
  const dkim = header.match(/dkim=(\w+)(?:[^;]*?header\.d=([\w.-]+))?/i);
  const dmarc = header.match(/dmarc=(\w+)/i);
  if (spf) result.spf = { mechanism: "SPF", verdict: spf[1].toLowerCase() };
  if (dkim) result.dkim = { mechanism: "DKIM", verdict: dkim[1].toLowerCase(), domain: dkim[2]?.toLowerCase() };
  if (dmarc) result.dmarc = { mechanism: "DMARC", verdict: dmarc[1].toLowerCase() };
  return result;
}

// Falls back to parsing the raw DKIM-Signature header's own d= tag when
// Authentication-Results didn't carry header.d= (some MTAs omit it) —
// still the real signing domain the message claims, not a guess.
function parseDkimSignatureDomain(raw: string): string | null {
  const header = extractHeader(raw, "DKIM-Signature");
  if (!header) return null;
  const match = header.match(/(?:^|;)\s*d=([\w.-]+)/i);
  return match ? match[1].toLowerCase() : null;
}

function parseReceivedHops(raw: string): Hop[] {
  const matches = [...raw.matchAll(/^Received:\s*(.+(?:\r?\n[ \t].+)*)/gim)];
  return matches.map((m) => {
    const text = m[1].replace(/\r?\n[ \t]+/g, " ").trim();
    const ipMatch = text.match(/\[?((?:\d{1,3}\.){3}\d{1,3})\]?/) ?? text.match(/([0-9a-fA-F:]{6,})/);
    const fromMatch = text.match(/from\s+(\S+)/i);
    const byMatch = text.match(/by\s+(\S+)/i);
    const dateMatch = text.match(/;\s*(.+)$/);
    const parsedDate = dateMatch ? new Date(dateMatch[1].trim()) : null;
    return {
      raw: text,
      ip: ipMatch ? ipMatch[1] : null,
      from: fromMatch ? fromMatch[1] : null,
      by: byMatch ? byMatch[1] : null,
      date: parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : null,
    };
  });
}

function detectAnomalies(hops: Hop[], headerDate: string | null): string[] {
  const anomalies: string[] = [];

  // Received headers read top-to-bottom = newest-to-oldest. Walking from
  // the bottom (oldest hop) upward, each subsequent hop's timestamp
  // should be equal or later — an earlier timestamp than the hop before
  // it is a classic sign of tampered/forged headers.
  const withDates = [...hops].reverse().filter((h) => h.date);
  for (let i = 1; i < withDates.length; i++) {
    if (withDates[i].date! < withDates[i - 1].date!) {
      anomalies.push(`Hop timestamp out of order: "${withDates[i].by ?? "unknown server"}" is dated before the hop before it — possible header manipulation.`);
    }
  }

  if (headerDate && withDates.length > 0) {
    const parsedHeaderDate = new Date(headerDate);
    const firstHopDate = withDates[0].date!;
    if (!isNaN(parsedHeaderDate.getTime())) {
      const diffHours = Math.abs(parsedHeaderDate.getTime() - firstHopDate.getTime()) / (1000 * 60 * 60);
      if (diffHours > 24) {
        anomalies.push(`The "Date" header (${parsedHeaderDate.toUTCString()}) differs from the first relay timestamp by ${diffHours.toFixed(0)} hours — worth a closer look.`);
      }
    }
  }

  return anomalies;
}

function parseHeaders(raw: string): Parsed {
  const { spf, dkim, dmarc } = parseAuthResults(raw);
  const hops = parseReceivedHops(raw);
  const date = extractHeader(raw, "Date");
  const from = extractHeader(raw, "From");
  const fromDomain = extractDomain(from);

  // The oldest "Received" hop (bottom of the headers, walked from the
  // reversed list forward) is closest to the real sender — but it's
  // frequently a PRIVATE address (the sender's own internal relay,
  // 127.0.0.1, a Docker/NAT range) rather than the actual public IP the
  // message left from. Picking "the last hop with any IP" as done
  // before silently reports a useless internal address in that case;
  // the real forensic technique is to walk oldest-to-newest and take the
  // first PUBLIC IP encountered.
  const chronological = [...hops].reverse();
  const originatingIp =
    chronological.find((h) => h.ip && !isPrivateOrReservedIp(h.ip))?.ip ??
    chronological.find((h) => h.ip)?.ip ??
    null;

  const xOriginatingIp = extractHeader(raw, "X-Originating-IP")?.replace(/[[\]]/g, "").trim() ?? null;
  const dkimSigDomain = dkim?.domain ?? parseDkimSignatureDomain(raw);

  return {
    from,
    to: extractHeader(raw, "To"),
    replyTo: extractHeader(raw, "Reply-To"),
    returnPath: extractHeader(raw, "Return-Path"),
    subject: extractHeader(raw, "Subject"),
    date,
    messageId: extractHeader(raw, "Message-ID"),
    spf,
    dkim,
    dmarc,
    hops,
    originatingIp,
    xOriginatingIp,
    dkimSigDomain,
    anomalies: [
      ...detectAnomalies(hops, date),
      ...detectReplyToMismatch(from, extractHeader(raw, "Reply-To")),
      ...detectDkimAlignment(fromDomain, dkimSigDomain, dkim?.verdict),
      ...detectDisplayNameImpersonation(from),
    ],
  };
}

function extractDomain(address: string | null): string | null {
  if (!address) return null;
  const match = address.match(/@([\w.-]+)/);
  return match ? match[1].toLowerCase() : null;
}

function extractEmailAddress(header: string | null): string | null {
  if (!header) return null;
  const angle = header.match(/<([^>]+@[^>]+)>/);
  if (angle) return angle[1].trim().toLowerCase();
  const bare = header.match(/[^\s<>]+@[^\s<>]+/);
  return bare ? bare[0].toLowerCase() : null;
}

function detectReplyToMismatch(from: string | null, replyTo: string | null): string[] {
  const fromDomain = extractDomain(from);
  const replyToDomain = extractDomain(replyTo);
  if (fromDomain && replyToDomain && fromDomain !== replyToDomain) {
    return [`Reply-To domain (${replyToDomain}) differs from From domain (${fromDomain}) — a common phishing pattern where replies get redirected away from the apparent sender.`];
  }
  return [];
}

// DMARC's actual definition of "aligned": the domain DKIM signed with (or
// SPF's Return-Path domain) must match — organizationally, not letter for
// letter — the visible From domain. A message can show dkim=pass while the
// signing domain is a completely different, unrelated one (e.g. signed by
// a mass-mailer's own domain) — that passes DKIM as a *signature check*
// but is NOT DMARC-aligned, which is the actual anti-spoofing guarantee.
function isAligned(a: string, b: string): boolean {
  const strip = (d: string) => d.split(".").slice(-2).join(".");
  return strip(a) === strip(b);
}

function detectDkimAlignment(fromDomain: string | null, dkimDomain: string | null, dkimVerdict: string | undefined): string[] {
  if (!fromDomain || !dkimDomain || dkimVerdict !== "pass") return [];
  if (!isAligned(fromDomain, dkimDomain)) {
    return [`DKIM passed but signed by a different domain (${dkimDomain}) than the visible From domain (${fromDomain}) — a valid signature that isn't DMARC-aligned, not the same as "this really is ${fromDomain}."`];
  }
  return [];
}

// A curated set of frequently-impersonated brands and their real,
// registrable domain(s) — the same technique real phishing-detection
// heuristics use. Checking against the brand's ACTUAL domain (not just
// "does the domain contain the brand name anywhere") matters: a
// combosquatting domain like totally-not-paypal.com contains "paypal"
// as a substring precisely to look convincing, so a naive substring
// check on the domain would miss the exact cases this exists to catch.
const IMPERSONATION_TARGETS: { name: string; domains: string[] }[] = [
  { name: "paypal", domains: ["paypal.com"] },
  { name: "microsoft", domains: ["microsoft.com", "outlook.com", "live.com", "office.com"] },
  { name: "apple", domains: ["apple.com", "icloud.com"] },
  { name: "amazon", domains: ["amazon.com"] },
  { name: "google", domains: ["google.com", "gmail.com"] },
  { name: "netflix", domains: ["netflix.com"] },
  { name: "bank of america", domains: ["bankofamerica.com"] },
  { name: "wells fargo", domains: ["wellsfargo.com"] },
  { name: "chase", domains: ["chase.com"] },
  { name: "irs", domains: ["irs.gov"] },
  { name: "docusign", domains: ["docusign.com", "docusign.net"] },
  { name: "fedex", domains: ["fedex.com"] },
  { name: "ups", domains: ["ups.com"] },
  { name: "dhl", domains: ["dhl.com"] },
  { name: "linkedin", domains: ["linkedin.com"] },
  { name: "facebook", domains: ["facebook.com", "fb.com"] },
  { name: "instagram", domains: ["instagram.com"] },
  { name: "coinbase", domains: ["coinbase.com"] },
  { name: "binance", domains: ["binance.com"] },
];

function detectDisplayNameImpersonation(from: string | null): string[] {
  if (!from) return [];
  const angleMatch = from.match(/^"?([^"<]+)"?\s*<([^>]+)>/);
  if (!angleMatch) return [];
  const displayName = angleMatch[1].trim().toLowerCase();
  const domain = extractDomain(from);
  if (!domain) return [];

  for (const brand of IMPERSONATION_TARGETS) {
    if (!displayName.includes(brand.name)) continue;
    const legit = brand.domains.some((d) => domain === d || domain.endsWith(`.${d}`));
    if (!legit) {
      return [`Display name claims to be "${angleMatch[1].trim()}" but the actual sending domain (${domain}) isn't ${brand.domains[0]} — a classic brand-impersonation pattern.`];
    }
  }
  return [];
}

function VerdictBadge({ result }: { result: AuthResult }) {
  if (!result) {
    return (
      <span className="flex items-center gap-1 text-xs text-slate-500">
        <HelpCircle className="h-3.5 w-3.5" /> Not present in headers
      </span>
    );
  }
  const pass = result.verdict === "pass";
  const fail = result.verdict === "fail" || result.verdict === "softfail" || result.verdict === "permerror";
  return (
    <span
      className={`flex items-center gap-1 text-xs ${
        pass ? "text-emerald-300" : fail ? "text-red-300" : "text-amber-300"
      }`}
    >
      {pass ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {result.mechanism}: {result.verdict}
      {result.domain && <span className="text-slate-500 font-mono">(d={result.domain})</span>}
    </span>
  );
}

export default function EmailHeaderTool() {
  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const { runLookup, setActiveTool, mergeGraph, addTimelineEvent } = useInvestigation();

  function handleParse() {
    if (!raw.trim()) return;
    setParsed(parseHeaders(raw));
  }

  function checkIp(ip: string) {
    setActiveTool("overview");
    runLookup(ip);
  }

  function pinToGraph() {
    if (!parsed) return;
    const nodes: GraphNodeData[] = [];
    const edges: GraphEdgeData[] = [];

    const fromEmail = extractEmailAddress(parsed.from);
    const fromDomain = extractDomain(parsed.from);
    let emailId: string | null = null;
    if (fromEmail) {
      emailId = `email:${fromEmail}`;
      nodes.push({
        id: emailId,
        type: "email",
        label: fromEmail,
        detail: parsed.subject ? `Header analysis · "${parsed.subject}"` : "Header analysis",
      });
    }
    if (fromDomain) {
      const domainId = `domain:${fromDomain}`;
      nodes.push({ id: domainId, type: "domain", label: fromDomain });
      if (emailId) edges.push({ id: `${emailId}->${domainId}`, source: emailId, target: domainId, relationship: "BELONGS_TO" });
    }

    const uniqueIps = Array.from(new Set(parsed.hops.map((h) => h.ip).filter((ip): ip is string => Boolean(ip))));
    for (const ip of uniqueIps) {
      const ipId = `ip:${ip}`;
      nodes.push({ id: ipId, type: "ip", label: ip, detail: ip === parsed.originatingIp ? "Likely originating IP" : "Relay hop" });
      if (emailId) edges.push({ id: `${emailId}->${ipId}`, source: emailId, target: ipId, relationship: "RELATED_TO" });
    }

    if (nodes.length === 0) return;
    mergeGraph(nodes, edges);
    addTimelineEvent({ tool: "forensics", label: "Email header pinned", detail: fromEmail ?? fromDomain ?? "header analysis" });
  }

  async function handleEmlUpload(file: File) {
    const text = await file.text();
    setRaw(text);
    setParsed(parseHeaders(text));
  }

  return (
    <div className="glass-panel p-4 space-y-4">
      <div>
        <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
          <Mail className="h-4 w-4 text-accent" /> Email Header Forensics
        </h2>
        <p className="text-xs text-slate-500">
          Paste the full raw headers (view source / "show original" in your mail client).
          Everything is parsed locally in your browser — nothing is sent anywhere.
        </p>
      </div>

      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="Received: from ...&#10;Authentication-Results: ...&#10;From: ...&#10;..."
        rows={8}
        dir="ltr"
        className="w-full bg-panel/60 border border-border rounded-lg p-3 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
      />

      <div className="flex items-center gap-2">
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleParse}
          disabled={!raw.trim()}
          className="text-xs px-3 py-1.5 rounded-md bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors"
        >
          Parse Headers
        </motion.button>
        <label className="text-xs px-3 py-1.5 rounded-md border border-border hover:border-accent/50 text-slate-300 cursor-pointer flex items-center gap-1.5">
          <Upload className="h-3.5 w-3.5" /> Upload .eml
          <input
            type="file"
            accept=".eml,message/rfc822"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleEmlUpload(f); }}
          />
        </label>
      </div>

      {parsed && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 text-sm">
          <div className="flex justify-end">
            <button
              onClick={pinToGraph}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
            >
              <Pin className="h-3 w-3" /> Pin to Intelligence Graph
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-border p-3 space-y-1">
              <p className="text-xs"><span className="text-slate-500">From:</span> <span className="text-slate-200 break-all">{parsed.from ?? "—"}</span></p>
              <p className="text-xs"><span className="text-slate-500">To:</span> <span className="text-slate-200 break-all">{parsed.to ?? "—"}</span></p>
              {parsed.replyTo && <p className="text-xs"><span className="text-slate-500">Reply-To:</span> <span className="text-amber-300 break-all">{parsed.replyTo}</span></p>}
              {parsed.returnPath && <p className="text-xs"><span className="text-slate-500">Return-Path:</span> <span className="text-slate-200 break-all">{parsed.returnPath}</span></p>}
              <p className="text-xs"><span className="text-slate-500">Subject:</span> <span className="text-slate-200 break-all">{parsed.subject ?? "—"}</span></p>
              <p className="text-xs"><span className="text-slate-500">Date:</span> <span className="text-slate-200">{parsed.date ?? "—"}</span></p>
            </div>
            <div className="rounded-lg border border-border p-3 space-y-2">
              <p className="text-[11px] text-slate-500">Authentication</p>
              <VerdictBadge result={parsed.spf} />
              <VerdictBadge result={parsed.dkim} />
              <VerdictBadge result={parsed.dmarc} />
            </div>
          </div>

          {parsed.anomalies.length > 0 && (
            <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-red-300 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> {parsed.anomalies.length} anomal{parsed.anomalies.length === 1 ? "y" : "ies"} detected
              </p>
              {parsed.anomalies.map((a, i) => (
                <p key={i} className="text-[11px] text-slate-300">• {a}</p>
              ))}
            </div>
          )}

          {parsed.originatingIp && (
            <div className="rounded-lg border border-accent/40 bg-accent/10 p-3 flex items-center justify-between">
              <p className="text-xs text-slate-200">
                Likely originating IP (first public IP walking from the oldest hop): <span className="font-mono">{parsed.originatingIp}</span>
                {isPrivateOrReservedIp(parsed.originatingIp) && <span className="text-amber-300"> — private/internal address, not the real public origin</span>}
              </p>
              <button
                onClick={() => checkIp(parsed.originatingIp!)}
                className="flex items-center gap-1 text-xs text-accent-glow hover:underline"
              >
                Analyze this IP <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          )}

          {parsed.xOriginatingIp && (
            <div className="rounded-lg border border-border p-3 flex items-center justify-between">
              <p className="text-xs text-slate-200">
                X-Originating-IP header (provider-supplied, e.g. Outlook/older webmail): <span className="font-mono">{parsed.xOriginatingIp}</span>
              </p>
              <button
                onClick={() => checkIp(parsed.xOriginatingIp!)}
                className="flex items-center gap-1 text-xs text-accent-glow hover:underline"
              >
                Analyze this IP <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          )}

          <div>
            <p className="text-[11px] text-slate-500 mb-2">
              Relay chain ({parsed.hops.length} hop{parsed.hops.length === 1 ? "" : "s"}, top = most recent)
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {parsed.hops.length === 0 && (
                <p className="text-xs text-slate-500">No "Received" headers found in the pasted text.</p>
              )}
              {parsed.hops.map((hop, i) => (
                <div key={i} className="rounded-lg border border-border p-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300">
                      {hop.from ?? "?"} → {hop.by ?? "?"}
                    </span>
                    {hop.ip && (
                      <button
                        onClick={() => checkIp(hop.ip!)}
                        className={`font-mono hover:underline ${isPrivateOrReservedIp(hop.ip) ? "text-slate-600" : "text-accent-glow"}`}
                        title={isPrivateOrReservedIp(hop.ip) ? "Private/internal address" : undefined}
                      >
                        {hop.ip}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
