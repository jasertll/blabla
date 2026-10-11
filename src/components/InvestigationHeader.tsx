"use client";

import { Crosshair } from "lucide-react";

// A persistent "you are here" banner an analyst workspace should have —
// once a target is loaded, the tool's internal tabs (Overview/DNS/
// Certificate/etc.) sit underneath this so context never gets lost while
// switching between them. Purely a framing/label component; it doesn't
// own any state itself.
export default function InvestigationHeader({ target }: { target: string }) {
  return (
    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border/60">
      <Crosshair className="h-3.5 w-3.5 text-accent shrink-0" />
      <span className="text-[10px] uppercase tracking-widest text-slate-500 hud-text">Investigation</span>
      <span className="font-mono text-sm text-accent-glow truncate">{target}</span>
    </div>
  );
}
