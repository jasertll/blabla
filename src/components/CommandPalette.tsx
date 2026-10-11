"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, CornerDownLeft } from "lucide-react";
import { useInvestigation } from "@/contexts/InvestigationContext";
import { NAV_GROUPS } from "@/lib/navItems";

const FLAT_ITEMS = NAV_GROUPS.flatMap((g) => g.items.map((item) => ({ ...item, group: g.label })));

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return true;
  if (t.includes(q)) return true;
  // Loose subsequence match — lets "dsc" find "Domain Scan" even without
  // the exact substring.
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { setActiveTool, toolAlerts } = useInvestigation();

  const results = useMemo(
    () => FLAT_ITEMS.filter((item) => fuzzyMatch(query, `${item.label} ${item.group}`)),
    [query]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    // Also toggleable from a plain click (see the "⌘K" hint in HudBar) —
    // a custom event keeps that button decoupled from this component's
    // internal state instead of lifting it up through layout.tsx.
    function onToggleEvent() {
      setOpen((v) => !v);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("jaser:toggle-command-palette", onToggleEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("jaser:toggle-command-palette", onToggleEvent);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      // Focus after the entrance transition mounts the input.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  function choose(index: number) {
    const item = results[index];
    if (!item) return;
    setActiveTool(item.id);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(selected);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh] px-4"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg glass-panel border border-border rounded-xl overflow-hidden shadow-2xl"
          >
            <div className="flex items-center gap-2 px-3.5 py-3 border-b border-border/60">
              <Search className="h-4 w-4 text-slate-500 shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Jump to a tool… (e.g. domain, recon, forensics)"
                dir="ltr"
                className="flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none"
              />
              <kbd className="hidden sm:block text-[10px] font-mono text-slate-600 border border-border rounded px-1.5 py-0.5">ESC</kbd>
            </div>

            <div className="max-h-80 overflow-y-auto py-1.5">
              {results.length === 0 && (
                <p className="px-3.5 py-4 text-xs text-slate-500 text-center">No tools match &quot;{query}&quot;.</p>
              )}
              {results.map((item, i) => (
                <button
                  key={item.id}
                  onClick={() => choose(i)}
                  onMouseEnter={() => setSelected(i)}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left transition-colors ${
                    i === selected ? "bg-surface-high text-slate-100" : "text-slate-400 hover:bg-surface-elevated"
                  }`}
                >
                  <item.icon className={`h-3.5 w-3.5 shrink-0 ${i === selected ? "text-accent-glow" : ""}`} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs truncate">{item.label}</span>
                    <span className="block text-[10px] text-slate-600">{item.group}</span>
                  </span>
                  {toolAlerts[item.id] && <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" aria-hidden="true" />}
                  {i === selected && <CornerDownLeft className="h-3 w-3 text-slate-600 shrink-0" />}
                </button>
              ))}
            </div>

            <div className="px-3.5 py-2 border-t border-border/60 flex items-center gap-3 text-[10px] text-slate-600">
              <span>↑↓ navigate</span>
              <span>↵ select</span>
              <span className="ml-auto hud-text">JASER-CMD</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
