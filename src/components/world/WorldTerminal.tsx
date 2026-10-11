"use client";

import { Terminal as TerminalIcon } from "lucide-react";

// The one interactive object in this first vertical slice. "Awake" is a
// permanent ambient state (a real console in a real facility has power,
// not a reason to fake activity) — `near` is what actually changes when
// Jaser approaches, surfacing the investigate prompt per the architecture
// audit's §30/§31 interaction model.
export default function WorldTerminal({ near, label, onInteract }: { near: boolean; label: string; onInteract: () => void }) {
  return (
    <div className="relative flex flex-col items-center" style={{ width: 64 }}>
      {near && (
        <button
          type="button"
          data-world-interact
          onClick={onInteract}
          className="absolute -top-9 whitespace-nowrap hud-text text-[10px] text-terminal-bright border border-terminal/60 bg-[#05040a]/90 rounded px-2 py-1 pointer-events-auto animate-pulse hover:bg-terminal/10"
        >
          [E] INVESTIGATE — {label}
        </button>
      )}
      <div
        className="relative w-14 h-20 rounded-t-md border flex items-center justify-center"
        style={{
          background: "linear-gradient(180deg, #121020 0%, #0a0815 100%)",
          borderColor: near ? "rgba(45,212,191,0.9)" : "rgba(45,212,191,0.35)",
          boxShadow: near ? "0 0 22px rgba(45,212,191,0.55)" : "0 0 10px rgba(45,212,191,0.2)",
          transition: "border-color 0.25s ease, box-shadow 0.25s ease",
        }}
      >
        <TerminalIcon className={`h-6 w-6 ${near ? "text-terminal-bright" : "text-terminal/70"}`} />
        <span
          className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-terminal-bright"
          style={{ animation: "pulse 1.8s ease-in-out infinite" }}
          aria-hidden="true"
        />
      </div>
      <div className="w-16 h-2 rounded-b-sm bg-[#0a0815] border-x border-b border-terminal/20" />
    </div>
  );
}
