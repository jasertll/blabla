"use client";

import { useMemo, useState } from "react";
import { Search, Copy, Check, ExternalLink } from "lucide-react";
import { buildDorks, detectDorkMode } from "@/lib/dorkBuilder";
import { useInvestigation } from "@/contexts/InvestigationContext";

const RISK_STYLE: Record<string, string> = {
  info: "text-slate-500",
  caution: "text-amber-400",
  sensitive: "text-red-400",
};

function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title="Copy query"
      className="text-slate-500 hover:text-slate-200 transition-colors shrink-0"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export default function DorkBuilder() {
  const [target, setTarget] = useState("");
  const [committed, setCommitted] = useState("");
  const { addTimelineEvent } = useInvestigation();
  const groups = useMemo(() => buildDorks(committed), [committed]);
  const mode = useMemo(() => (committed ? detectDorkMode(committed) : null), [committed]);

  function generate() {
    if (!target.trim()) return;
    setCommitted(target.trim());
    addTimelineEvent({ tool: "recon", label: "Google Dork Builder", detail: target.trim() });
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <Search className="h-3.5 w-3.5 text-accent" /> Google Dork Builder
      </p>
      <p className="text-[11px] text-slate-500">
        Enter a <span className="text-slate-300">domain</span> (e.g. example.com) for site recon
        dorks — exposed documents, login surfaces, leaked secrets — or a{" "}
        <span className="text-slate-300">person's name, company, or topic</span> (e.g. a full name
        or a book title) for social-profile and document-mention dorks instead. Nothing is executed
        automatically; every query is copy-ready or opens directly in Google/Bing when you click it.
      </p>

      <div className="flex gap-2">
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generate()}
          placeholder="e.g. example.com — or a full name / book title"
          dir="ltr"
          className="flex-1 bg-panel/60 border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
        />
        <button
          onClick={generate}
          disabled={!target.trim()}
          className="text-xs px-3 py-1.5 rounded-md bg-accent/80 hover:bg-accent text-white disabled:opacity-40 transition-colors"
        >
          Generate
        </button>
      </div>

      {mode && (
        <p className="text-[11px] text-slate-500">
          Detected as a <span className="text-accent-glow">{mode === "domain" ? "domain" : "name / topic"}</span> —
          {mode === "domain"
            ? " showing site-recon dorks (site:-scoped)."
            : " showing person/topic dorks (no site: restriction on the query itself)."}
        </p>
      )}

      {groups.length > 0 && (
        <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
          {groups.map((g) => (
            <div key={g.category}>
              <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1">{g.category}</p>
              <div className="space-y-1">
                {g.items.map((item) => (
                  <div
                    key={item.query}
                    className="flex items-center gap-2 rounded-md border border-border/60 bg-[#0d0a18] px-2 py-1.5"
                  >
                    <span className={`text-[9px] uppercase font-bold shrink-0 w-14 ${RISK_STYLE[item.risk]}`}>{item.risk}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-slate-300 truncate">{item.label}</p>
                      <p className="text-[10px] font-mono text-slate-500 truncate" dir="ltr">{item.query}</p>
                    </div>
                    <CopyChip text={item.query} />
                    <a
                      href={item.googleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open in Google"
                      className="text-slate-500 hover:text-accent-glow transition-colors shrink-0"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
