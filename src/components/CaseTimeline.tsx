"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Download, Clock } from "lucide-react";
import { useInvestigation } from "@/contexts/InvestigationContext";
import { NAV_GROUPS } from "@/lib/navItems";

const ICON_BY_TOOL = Object.fromEntries(NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.id, i.icon]));
const LABEL_BY_TOOL = Object.fromEntries(NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.id, i.label]));

function exportTimelineText(timeline: { tool: string; label: string; detail?: string; at: number }[]): string {
  const lines = [
    "JASER — CASE TIMELINE",
    `Exported ${new Date().toLocaleString()}`,
    `${timeline.length} action${timeline.length === 1 ? "" : "s"} this session`,
    "",
    ...[...timeline].reverse().map((e) => {
      const tool = LABEL_BY_TOOL[e.tool] ?? e.tool;
      const time = new Date(e.at).toLocaleString();
      return `[${time}] ${tool} — ${e.label}${e.detail ? `: ${e.detail}` : ""}`;
    }),
  ];
  return lines.join("\n");
}

export default function CaseTimeline() {
  const [open, setOpen] = useState(false);
  const { timeline, setActiveTool } = useInvestigation();

  useEffect(() => {
    function onToggle() {
      setOpen((v) => !v);
    }
    window.addEventListener("jaser:toggle-timeline", onToggle);
    return () => window.removeEventListener("jaser:toggle-timeline", onToggle);
  }, []);

  function exportTimeline() {
    const text = exportTimelineText(timeline);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jaser-case-timeline-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[85] bg-black/50"
            onClick={() => setOpen(false)}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.2 }}
            className="fixed right-0 top-0 bottom-0 z-[86] w-full max-w-sm glass-panel border-l border-border flex flex-col"
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
              <Clock className="h-4 w-4 text-accent shrink-0" />
              <h2 className="font-display font-semibold text-sm text-slate-100 flex-1">Case Timeline</h2>
              <button
                onClick={exportTimeline}
                disabled={timeline.length === 0}
                title="Export as text"
                className="text-slate-500 hover:text-slate-200 disabled:opacity-30 transition-colors"
              >
                <Download className="h-4 w-4" />
              </button>
              <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-200 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="px-4 py-2 text-[11px] text-slate-500 border-b border-border/60">
              Every lookup and pivot this session, newest first — local to this browser tab, not saved anywhere.
            </p>

            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
              {timeline.length === 0 && (
                <p className="text-xs text-slate-600 text-center py-8">No actions logged yet — run a scan to start the timeline.</p>
              )}
              {timeline.map((event) => {
                const Icon = ICON_BY_TOOL[event.tool];
                return (
                  <button
                    key={event.id}
                    onClick={() => {
                      setActiveTool(event.tool as any);
                      setOpen(false);
                    }}
                    className="w-full flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-surface-elevated transition-colors"
                  >
                    {Icon && <Icon className="h-3.5 w-3.5 text-accent-glow shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-200 truncate">{event.label}</p>
                      {event.detail && <p className="text-[11px] font-mono text-slate-500 truncate">{event.detail}</p>}
                      <p className="text-[10px] text-slate-600">{new Date(event.at).toLocaleTimeString()}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
