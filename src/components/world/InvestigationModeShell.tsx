"use client";

import { motion } from "framer-motion";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import IpAnalyzer from "@/components/IpAnalyzer";
import DomainScan from "@/components/DomainScan";
import { useSafeReducedMotion } from "@/lib/useSafeReducedMotion";
import type { ToolId } from "@/contexts/InvestigationContext";

// Per the architecture audit's §10: the real tool component is mounted
// completely unmodified inside this shell — a tool component doesn't know
// or care that it's being presented differently here versus from the
// normal SideNav/activeTool switchboard. That's deliberate: Investigation
// Mode is purely a presentation wrapper, never a fork of a tool's logic.
//
// Extending TOOL_COMPONENTS is how each new room's terminal plugs in an
// existing tool — never a reason to duplicate a tool's logic into a
// world-specific copy.
const TOOL_COMPONENTS: Partial<Record<ToolId, () => React.JSX.Element>> = {
  ip: IpAnalyzer,
  domain: DomainScan,
};

export default function InvestigationModeShell({
  toolId,
  label,
  onReturn,
}: {
  toolId: ToolId;
  label: string;
  onReturn: () => void;
}) {
  const reduceMotion = useSafeReducedMotion();
  const ToolComponent = TOOL_COMPONENTS[toolId];

  const transition = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, scale: 1.08, filter: "blur(10px)" },
        animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
        exit: { opacity: 0, scale: 1.05, filter: "blur(8px)" },
      };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[70] bg-[#05040a]/92 backdrop-blur-sm overflow-y-auto"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between px-5 md:px-10 py-4 bg-[#05040a]/85 backdrop-blur border-b border-terminal/20">
        <div>
          <p className="hud-text text-[10px] text-terminal/80 tracking-widest">INVESTIGATION MODE</p>
          <p className="text-sm text-slate-200 font-medium">{label}</p>
        </div>
        <button
          type="button"
          onClick={onReturn}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md border border-border text-slate-300 hover:border-terminal/50 hover:text-terminal-bright transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> RETURN TO WORLD
        </button>
      </div>

      <motion.div {...transition} transition={{ duration: 0.45 }} className="max-w-[1400px] mx-auto px-5 md:px-10 py-8">
        {ToolComponent ? (
          <ToolComponent />
        ) : (
          <div className="flex items-center gap-2 text-sm text-amber-300">
            <ShieldAlert className="h-4 w-4" /> No tool wired for this terminal yet.
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
