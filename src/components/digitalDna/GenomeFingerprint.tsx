"use client";

import type { GenomeRegion } from "@/lib/fileGenome";
import { REGION_CLASS_COLOR } from "@/lib/fileGenome";

// A single-row "barcode" of the whole file, one real stripe per region,
// colored by STRUCTURAL CLASSIFICATION rather than raw entropy value —
// a deliberately different encoding from the heatmap above it, so the
// two together show both "how random" (heatmap) and "what kind of data"
// (fingerprint) at a glance. Deterministic from the file's own bytes:
// the same file always produces the exact same stripe pattern, and two
// different files visibly look different — a real fingerprint, not a
// decorative pattern.
export default function GenomeFingerprint({
  regions,
  selectedIndex,
  onSelect,
  revealCount,
}: {
  regions: GenomeRegion[];
  selectedIndex: number | null;
  onSelect: (i: number) => void;
  revealCount: number;
}) {
  const width = 1000;
  const height = 34;
  const barW = width / Math.max(1, regions.length);

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[11px] text-slate-400 mb-2">File genome fingerprint — structural classification per region, a visual signature unique to this file's actual byte structure</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-8" preserveAspectRatio="none">
        {regions.slice(0, revealCount).map((r) => {
          const isActive = selectedIndex === r.index;
          return (
            <rect
              key={r.index}
              x={r.index * barW}
              y={0}
              width={Math.max(1, barW - 0.2)}
              height={height}
              fill={REGION_CLASS_COLOR[r.classification]}
              opacity={selectedIndex !== null && !isActive ? 0.4 : 0.95}
              stroke={isActive ? "#fff" : "none"}
              strokeWidth={isActive ? 1 : 0}
              onClick={() => onSelect(r.index)}
              className="cursor-pointer"
            />
          );
        })}
      </svg>
    </div>
  );
}
