"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Crosshair } from "lucide-react";
import type { GenomeRegion } from "@/lib/fileGenome";
import { REGION_CLASS_LABEL, REGION_CLASS_COLOR } from "@/lib/fileGenome";
import { entropyColor, formatBytes } from "./shared";

// The single shared "you clicked/hovered a region" readout — every
// visualization in this tool writes to the same selectedIndex/
// hoveredIndex state and reads from the same regions array, so whatever
// gets shown here is always consistent with whatever is highlighted
// across the heatmap, topology, graph, fingerprint, and 3D landscape.
export default function SelectedRegionPanel({ region, live }: { region: GenomeRegion | null; live: boolean }) {
  // key is "region"/"empty" (NOT region.index) so moving the hover
  // between different regions — the common, rapid-fire case while
  // scrubbing across the heatmap — just updates this same mounted
  // element's content with no exit/enter cycle at all. Only the rarer
  // empty↔populated transition animates, and without "wait" mode so
  // that transition doesn't block new content behind an old one exiting.
  return (
    <AnimatePresence initial={false}>
      {region ? (
        <motion.div
          key="region"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="rounded-lg border border-accent/40 bg-panel/90 backdrop-blur-sm p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]"
        >
          <div>
            <p className="text-slate-500">{live ? "HOVERED REGION" : "SELECTED REGION"}</p>
            <p className="text-slate-200 font-mono mt-0.5">
              #{region.index} · bytes {region.startByte.toLocaleString()}–{region.endByte.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-slate-500">SIZE</p>
            <p className="text-slate-200 font-mono mt-0.5">{formatBytes(region.endByte - region.startByte)}</p>
          </div>
          <div>
            <p className="text-slate-500">ENTROPY</p>
            <p className="font-mono mt-0.5" style={{ color: entropyColor(region.entropy) }}>
              {region.entropy.toFixed(2)} / 8 bits/byte
            </p>
          </div>
          <div>
            <p className="text-slate-500">CLASSIFICATION</p>
            <p className="font-mono mt-0.5" style={{ color: REGION_CLASS_COLOR[region.classification] }}>
              {REGION_CLASS_LABEL[region.classification]}
            </p>
          </div>
          <div>
            <p className="text-slate-500">UNIQUE BYTE VALUES</p>
            <p className="text-slate-300 font-mono mt-0.5">{region.uniqueByteCount} / 256</p>
          </div>
          <div>
            <p className="text-slate-500">MOST COMMON BYTE</p>
            <p className="text-slate-300 font-mono mt-0.5">
              0x{region.mostCommonByte.toString(16).padStart(2, "0")} ({(region.mostCommonByteFraction * 100).toFixed(0)}%)
            </p>
          </div>
          <div>
            <p className="text-slate-500">PRINTABLE-ASCII SHARE</p>
            <p className="text-slate-300 font-mono mt-0.5">{(region.printableFraction * 100).toFixed(0)}%</p>
          </div>
          <div>
            <p className="text-slate-500">SIMILAR REGIONS ELSEWHERE</p>
            <p className="text-slate-300 font-mono mt-0.5">{region.density}</p>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="empty"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="rounded-lg border border-border p-3 flex items-center gap-2 text-[11px] text-slate-500"
        >
          <Crosshair className="h-3.5 w-3.5" /> Hover or click any region below — heatmap, topology, graph, fingerprint, and the 3D landscape all stay in sync.
        </motion.div>
      )}
    </AnimatePresence>
  );
}
