"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Layers, Loader2, Download, CheckCircle2, AlertTriangle, HelpCircle, XCircle, ChevronDown } from "lucide-react";
import { detectIndicator, IndicatorType } from "@/lib/detectIndicator";
import { scoreIp, scoreDomain, ScoreFactor } from "@/lib/riskScore";

type Status = "pending" | "processing" | "clean" | "suspicious" | "malicious" | "unknown" | "error";

type BulkItem = {
  raw: string;
  type: IndicatorType;
  status: Status;
  detail: string;
  scoreTotal?: number;
  factors?: ScoreFactor[];
  data?: any;
};

function classifyFromScore(total: number): Status {
  if (total >= 55) return "malicious";
  if (total >= 25) return "suspicious";
  return "clean";
}

const STATUS_STYLE: Record<Status, { icon: typeof CheckCircle2; color: string }> = {
  pending: { icon: HelpCircle, color: "text-slate-500" },
  processing: { icon: Loader2, color: "text-accent" },
  clean: { icon: CheckCircle2, color: "text-emerald-400" },
  suspicious: { icon: AlertTriangle, color: "text-amber-400" },
  malicious: { icon: XCircle, color: "text-red-400" },
  unknown: { icon: HelpCircle, color: "text-slate-500" },
  error: { icon: XCircle, color: "text-slate-600" },
};

// Small "label: value" chip used throughout the expanded detail view.
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start gap-1.5">
      <span className="text-slate-500 shrink-0">{label}:</span>
      <span className="text-slate-300 break-all">{value}</span>
    </div>
  );
}

function IpDetail({ data }: { data: any }) {
  const geo = data.geo?.status === "ok" ? data.geo.data : null;
  const idb = data.internetdb?.status === "ok" ? data.internetdb.data : null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
      <Field label="Location" value={geo ? [geo.city, geo.country].filter(Boolean).join(", ") || null : "unavailable"} />
      <Field label="ISP / Org" value={geo ? geo.isp ?? geo.org : "unavailable"} />
      <Field label="Tor exit node" value={data.tor?.status === "ok" ? (data.tor.data.isTorExitNode ? "YES" : "no") : "unavailable"} />
      <Field label="Spamhaus ZEN" value={data.blacklist?.status === "ok" ? (data.blacklist.data.listed ? "LISTED" : "not listed") : "unavailable"} />
      <Field label="Reverse DNS" value={data.reverseDns?.status === "ok" ? data.reverseDns.data.hostnames.join(", ") : null} />
      <Field label="Open ports" value={idb && idb.ports.length > 0 ? idb.ports.join(", ") : idb ? "none reported" : "unavailable"} />
      {idb && idb.vulns.length > 0 && (
        <div className="sm:col-span-2 flex items-start gap-1.5">
          <span className="text-slate-500 shrink-0">Known CVEs:</span>
          <span className="text-red-300 break-all">{idb.vulns.join(", ")}</span>
        </div>
      )}
    </div>
  );
}

function DomainDetail({ data }: { data: any }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
      <Field label="A records" value={data.dns?.a?.join(", ") || "none"} />
      <Field label="AAAA records" value={data.dns?.aaaa?.join(", ") || null} />
      <Field label="MX" value={data.dns?.mx?.map((m: any) => m.exchange).join(", ") || "none"} />
      <Field label="Nameservers" value={data.dns?.ns?.join(", ") || null} />
      <Field label="SPF" value={data.security?.spf ? "present" : "MISSING"} />
      <Field label="DMARC" value={data.security?.dmarc ? "present" : "MISSING"} />
      <Field
        label="TLS"
        value={
          data.ssl?.status === "ok"
            ? `${data.ssl.data.issuer} · expires in ${data.ssl.data.daysUntilExpiry}d`
            : "unavailable"
        }
      />
      <Field
        label="Registered"
        value={data.whois?.status === "ok" && data.whois.data.createdDate ? new Date(data.whois.data.createdDate).toLocaleDateString() : "unavailable"}
      />
    </div>
  );
}

function HashDetail({ data }: { data: any }) {
  const hit = data.circlHashlookup;
  if (hit?.status === "ok") {
    return (
      <div className="text-[11px] space-y-1">
        <Field label="CIRCL match" value={hit.data.fileName ?? "unnamed"} />
        <p className="text-slate-500 italic">Known-good file DB match — not a malware verdict.</p>
      </div>
    );
  }
  return <p className="text-[11px] text-slate-500">Not present in CIRCL's known-good file database — unverified either way.</p>;
}

function ItemDetail({ item }: { item: BulkItem }) {
  if (!item.data) return <p className="text-[11px] text-slate-500">No detail captured for this indicator.</p>;
  return (
    <div className="space-y-2">
      {item.type === "ipv4" || item.type === "ipv6" ? (
        <IpDetail data={item.data} />
      ) : item.type === "domain" || item.type === "url" ? (
        <DomainDetail data={item.data} />
      ) : (
        <HashDetail data={item.data} />
      )}
      {item.factors && item.factors.length > 0 && (
        <div className="pt-2 border-t border-border/60 space-y-0.5">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Score breakdown</p>
          {item.factors.map((f, i) => (
            <p key={i} className="text-[11px] text-slate-400">
              <span className="text-accent-glow font-mono">+{f.points}</span> {f.reason}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BulkInvestigation() {
  const [input, setInput] = useState("");
  const [items, setItems] = useState<BulkItem[]>([]);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  async function processOne(item: BulkItem): Promise<BulkItem> {
    try {
      if (item.type === "ipv4" || item.type === "ipv6") {
        const res = await fetch(`/api/osint/ip?target=${encodeURIComponent(item.raw)}`);
        const json = await res.json();
        // Cross-reference against the real, full CISA KEV catalog before
        // scoring — same check every other tool uses, so a host with an
        // actively-exploited CVE doesn't silently score the same as one
        // with an obscure, unexploited CVE.
        const vulns: string[] = json.internetdb?.status === "ok" ? json.internetdb.data.vulns : [];
        let kevMatches: string[] = [];
        if (vulns.length > 0) {
          try {
            const kevRes = await fetch(`/api/osint/kevcheck?cves=${encodeURIComponent(vulns.join(","))}`);
            const kevJson = await kevRes.json();
            kevMatches = (kevJson.matches ?? []).map((m: { cveID: string }) => m.cveID);
          } catch {
            // Best-effort — score just falls back to the plain CVE-count signal.
          }
        }
        const score = scoreIp(json, kevMatches);
        return { ...item, status: classifyFromScore(score.total), detail: `Risk ${score.total}/100`, scoreTotal: score.total, factors: score.factors, data: json };
      }
      if (item.type === "domain" || item.type === "url") {
        let target = item.raw;
        if (item.type === "url") {
          try { target = new URL(item.raw).hostname; } catch { /* keep raw */ }
        }
        const res = await fetch(`/api/osint/domain?target=${encodeURIComponent(target)}`);
        const json = await res.json();
        const score = scoreDomain(json);
        return { ...item, status: classifyFromScore(score.total), detail: `Risk ${score.total}/100`, scoreTotal: score.total, factors: score.factors, data: json };
      }
      if (item.type === "md5" || item.type === "sha1" || item.type === "sha256") {
        const res = await fetch(`/api/osint/hash?target=${encodeURIComponent(item.raw)}`);
        const json = await res.json();
        if (json.circlHashlookup?.status === "ok") {
          return { ...item, status: "clean", detail: `Known-good: ${json.circlHashlookup.data.fileName ?? "unnamed"}`, data: json };
        }
        return { ...item, status: "unknown", detail: "Not in known-good database — unverified", data: json };
      }
      return { ...item, status: "unknown", detail: "Unsupported indicator type" };
    } catch {
      return { ...item, status: "error", detail: "Lookup failed" };
    }
  }

  async function runBulk() {
    const lines = Array.from(
      new Set(
        input
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
      )
    );
    const initial: BulkItem[] = lines.map((raw) => ({
      raw,
      type: detectIndicator(raw),
      status: "pending",
      detail: "",
    }));
    setItems(initial);
    setExpanded(null);
    setRunning(true);

    for (let i = 0; i < initial.length; i++) {
      setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: "processing" } : it)));
      const result = await processOne(initial[i]);
      setItems((prev) => prev.map((it, idx) => (idx === i ? result : it)));
      await new Promise((r) => setTimeout(r, 250));
    }

    setRunning(false);
  }

  function exportCsv() {
    const rows = [
      ["Indicator", "Type", "Status", "Detail", "Score Factors"],
      ...items.map((i) => [i.raw, i.type, i.status, i.detail, (i.factors ?? []).map((f) => f.reason).join(" | ")]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk-ioc-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const counts = {
    total: items.length,
    processed: items.filter((i) => !["pending", "processing"].includes(i.status)).length,
    malicious: items.filter((i) => i.status === "malicious").length,
    suspicious: items.filter((i) => i.status === "suspicious").length,
    clean: items.filter((i) => i.status === "clean").length,
    unknown: items.filter((i) => i.status === "unknown").length,
    errors: items.filter((i) => i.status === "error").length,
  };

  return (
    <div className="rounded-lg border border-border p-3 space-y-3 lg:col-span-2">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <Layers className="h-3.5 w-3.5 text-accent" /> Bulk IOC Investigation
      </p>
      <p className="text-[11px] text-slate-500">
        Paste IPs, domains, or hashes — one per line. Each one is run through the same real,
        keyless lookups as the individual tools (Shodan InternetDB, RDAP, Spamhaus, CIRCL), scored
        transparently, and classified. Click a row to expand the full detail behind its score.
        Processed sequentially to respect rate limits.
      </p>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={6}
        placeholder={"8.8.8.8\nexample.com\n44d88612fea8a8f36de82e1278abb02f"}
        dir="ltr"
        className="w-full bg-panel/60 border border-border rounded-lg p-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
      />

      <div className="flex gap-2">
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={runBulk}
          disabled={running || !input.trim()}
          className="text-xs px-3 py-1.5 rounded-md bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors flex items-center gap-1.5"
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {running ? "Processing…" : "Run Investigation"}
        </motion.button>
        {items.length > 0 && !running && (
          <button onClick={exportCsv} className="text-xs px-3 py-1.5 rounded-md border border-border hover:border-accent/50 text-slate-300 flex items-center gap-1.5">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        )}
      </div>

      {items.length > 0 && (
        <>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {[
              ["Total", counts.total, "text-slate-300"],
              ["Processed", counts.processed, "text-accent-glow"],
              ["Malicious", counts.malicious, "text-red-400"],
              ["Suspicious", counts.suspicious, "text-amber-400"],
              ["Clean", counts.clean, "text-emerald-400"],
              ["Unknown/Errors", counts.unknown + counts.errors, "text-slate-500"],
            ].map(([label, value, color]) => (
              <div key={label as string} className="rounded-lg bg-[#0d0a18] border border-border p-2 text-center">
                <p className={`text-lg font-bold ${color}`}>{value}</p>
                <p className="text-[9px] text-slate-500 uppercase">{label}</p>
              </div>
            ))}
          </div>

          <div className="space-y-1 max-h-[32rem] overflow-y-auto">
            {items.map((item, i) => {
              const style = STATUS_STYLE[item.status];
              const Icon = style.icon;
              const canExpand = Boolean(item.data) && item.status !== "processing" && item.status !== "pending";
              const isOpen = expanded === i;
              return (
                <div key={i} className="rounded-lg bg-[#0d0a18] border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => canExpand && setExpanded(isOpen ? null : i)}
                    disabled={!canExpand}
                    className={`w-full flex items-center gap-2 text-xs px-2.5 py-1.5 text-left ${canExpand ? "cursor-pointer hover:bg-panel/40" : "cursor-default"}`}
                  >
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${style.color} ${item.status === "processing" ? "animate-spin" : ""}`} />
                    <span className="font-mono text-slate-300 truncate flex-1">{item.raw}</span>
                    <span className="text-slate-500 text-[10px] uppercase shrink-0">{item.type}</span>
                    <span className="text-slate-400 text-[10px] shrink-0">{item.detail}</span>
                    {canExpand && (
                      <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-600 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    )}
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-3 pt-1 border-t border-border/60">
                      <ItemDetail item={item} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
