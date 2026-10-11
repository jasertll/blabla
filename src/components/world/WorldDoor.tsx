"use client";

import { DoorOpen } from "lucide-react";

// A room exit — same proximity-interact model as WorldTerminal (the
// directive's §28 interaction model applies uniformly to every
// interactive object, not just terminals), but moves the player to
// another room instead of opening a tool.
export default function WorldDoor({ near, onInteract }: { near: boolean; onInteract: () => void }) {
  return (
    <div className="relative flex flex-col items-center justify-end" style={{ width: 70, height: 220 }}>
      {near && (
        <button
          type="button"
          data-world-interact
          onClick={onInteract}
          className="absolute -top-9 whitespace-nowrap hud-text text-[10px] text-accent-glow border border-accent/60 bg-[#05040a]/90 rounded px-2 py-1 pointer-events-auto animate-pulse hover:bg-accent/10"
        >
          [E] ENTER
        </button>
      )}
      <div
        className="w-14 h-full rounded-t-full border-2"
        style={{
          borderColor: near ? "rgba(168,85,247,0.9)" : "rgba(168,85,247,0.35)",
          background: "radial-gradient(ellipse at 50% 30%, rgba(168,85,247,0.18), rgba(5,4,10,0.9) 75%)",
          boxShadow: near ? "0 0 26px rgba(168,85,247,0.5)" : "0 0 10px rgba(168,85,247,0.15)",
          transition: "border-color 0.25s ease, box-shadow 0.25s ease",
        }}
      >
        <DoorOpen className={`mx-auto mt-6 h-5 w-5 ${near ? "text-accent-glow" : "text-accent/60"}`} />
      </div>
    </div>
  );
}
