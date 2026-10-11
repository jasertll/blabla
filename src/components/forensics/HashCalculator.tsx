"use client";

import { useState } from "react";
import { Hash as HashIcon, Loader2, Copy, Check } from "lucide-react";

const ALGORITHMS = [
  { name: "SHA-1", label: "SHA-1" },
  { name: "SHA-256", label: "SHA-256" },
  { name: "SHA-384", label: "SHA-384" },
  { name: "SHA-512", label: "SHA-512" },
] as const;

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <div className="min-w-0">
        <span className="text-slate-500">{label}:</span>{" "}
        <span className="font-mono text-slate-200 break-all">{value}</span>
      </div>
      <button
        onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
        className="text-slate-400 hover:text-slate-200 shrink-0"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export default function HashCalculator() {
  const [fileName, setFileName] = useState("");
  const [hashes, setHashes] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleFile(file: File) {
    setLoading(true);
    setFileName(file.name);
    setHashes(null);
    const buffer = await file.arrayBuffer();

    const results: Record<string, string> = {};
    for (const algo of ALGORITHMS) {
      const digest = await crypto.subtle.digest(algo.name, buffer);
      results[algo.label] = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    setHashes(results);
    setLoading(false);
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <HashIcon className="h-3.5 w-3.5 text-accent" /> Multi-Algorithm Hash Calculator
      </p>
      <p className="text-[11px] text-slate-500">
        For evidence documentation / chain-of-custody notes. MD5 isn't included — modern browsers'
        Web Crypto API doesn't implement it (it's considered cryptographically broken); use
        SHA-256 as the standard reference hash instead.
      </p>
      <label className="flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg py-4 cursor-pointer text-xs text-slate-400 hover:border-accent/50 transition-colors">
        {fileName || "Click to choose a file"}
        <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </label>
      {loading && <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Hashing…</div>}
      {hashes && (
        <div className="rounded-lg bg-[#0d0a18] border border-border p-2.5 space-y-1.5">
          {Object.entries(hashes).map(([label, value]) => <CopyRow key={label} label={label} value={value} />)}
        </div>
      )}
    </div>
  );
}
