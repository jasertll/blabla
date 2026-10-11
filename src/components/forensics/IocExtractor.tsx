"use client";

import { useState } from "react";
import { ListFilter, ArrowRight, Copy, Check } from "lucide-react";
import { extractIocs, totalCount, isPrivateOrReservedIp, type ExtractedIocs } from "@/lib/iocExtractor";
import { useInvestigation } from "@/contexts/InvestigationContext";

const SECTIONS: { key: keyof ExtractedIocs; label: string; pivotable: boolean }[] = [
  { key: "ipv4", label: "IPv4 Addresses", pivotable: true },
  { key: "domains", label: "Domains", pivotable: true },
  { key: "urls", label: "URLs", pivotable: false },
  { key: "sha256", label: "SHA-256 Hashes", pivotable: true },
  { key: "sha1", label: "SHA-1 Hashes", pivotable: true },
  { key: "md5", label: "MD5 Hashes", pivotable: true },
  { key: "emails", label: "Email Addresses", pivotable: false },
  { key: "cves", label: "CVE IDs", pivotable: true },
];

function CopyAllButton({ values }: { values: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(values.join("\n"));
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title="Copy all"
      className="text-slate-500 hover:text-slate-200 transition-colors shrink-0 flex items-center gap-1 text-[10px]"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} copy all
    </button>
  );
}

export default function IocExtractor() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ExtractedIocs | null>(null);
  const { runLookup, setActiveTool } = useInvestigation();

  function extract() {
    if (!input.trim()) return;
    setResult(extractIocs(input));
  }

  function pivot(value: string) {
    setActiveTool("overview");
    runLookup(value);
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2 lg:col-span-2">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <ListFilter className="h-3.5 w-3.5 text-accent" /> IOC Extractor
      </p>
      <p className="text-[11px] text-slate-500">
        Paste raw log output, an email, a proxy/firewall export, or any text blob — it pulls out
        every IP, domain, URL, hash, and email address automatically. Everything runs locally.
      </p>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={6}
        placeholder="Paste log content here…"
        dir="ltr"
        className="w-full bg-panel/60 border border-border rounded-lg p-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
      />
      <button
        onClick={extract}
        disabled={!input.trim()}
        className="text-xs px-3 py-1.5 rounded-md bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors"
      >
        Extract IOCs
      </button>

      {result && (
        <div className="space-y-3 pt-2">
          <p className="text-[11px] text-slate-500">
            {totalCount(result)} indicators found
            {result.wasDefanged && <span className="text-accent-glow"> · defanged indicators (hxxp, [.], (at)) were automatically refanged</span>}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {SECTIONS.filter((s) => (result[s.key] as string[]).length > 0).map((s) => {
              const values = result[s.key] as string[];
              return (
              <div key={s.key} className="rounded-lg bg-[#0d0a18] border border-border p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">
                    {s.label} ({values.length})
                  </p>
                  <CopyAllButton values={values} />
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {values.map((value) => {
                    const isPrivate = s.key === "ipv4" && isPrivateOrReservedIp(value);
                    return (
                    <div key={value} className="flex items-center justify-between gap-2 text-xs font-mono text-slate-300 break-all">
                      <span className={`break-all ${isPrivate ? "text-slate-600" : ""}`}>
                        {value}
                        {isPrivate && <span className="text-[9px] text-slate-600 font-sans"> (private)</span>}
                      </span>
                      {s.pivotable && !isPrivate && (
                        <button
                          onClick={() => pivot(value)}
                          className="text-accent-glow hover:underline shrink-0 flex items-center gap-0.5"
                        >
                          Check <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
              );
            })}
          </div>
          {totalCount(result) === 0 && <p className="text-xs text-slate-500">No recognizable indicators found in that text.</p>}
        </div>
      )}
    </div>
  );
}
