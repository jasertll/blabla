"use client";

import { useState } from "react";
import type { GenomeRegion } from "@/lib/fileGenome";
import { entropyColor } from "./shared";

// Full-width, full-resolution entropy heatmap — every bar is one real
// sampled region (never averaged/blended), so hovering it always shows
// genuine offset/size/entropy/byte-statistics for that exact slice of
// the file, not an approximation.
export default function EntropyHeatmap({
  regions,
  fileSize,
  selectedIndex,
  onSelect,
  onHover,
  revealCount,
}: {
  regions: GenomeRegion[];
  fileSize: number;
  selectedIndex: number | null;
  onSelect: (i: number) => void;
  onHover: (i: number | null) => void;
  revealCount: number;
}) {
  const [localHover, setLocalHover] = useState<number | null>(null);
  const width = 1000;
  const height = 90;
  const barW = width / Math.max(1, regions.length);

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] text-slate-400">Entropy heatmap — {regions.length} real sampled regions, left = byte 0, right = end of file</p>
        <p className="text-[10px] text-slate-600 font-mono">{revealCount}/{regions.length} revealed</p>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-24" preserveAspectRatio="none">
        {regions.slice(0, revealCount).map((r) => {
          const isActive = selectedIndex === r.index || localHover === r.index;
          const barH = Math.max(2, (r.entropy / 8) * height);
          return (
            <rect
              key={r.index}
              x={r.index * barW}
              y={height - barH}
              width={Math.max(1, barW - 0.3)}
              height={barH}
              fill={entropyColor(r.entropy)}
              opacity={selectedIndex !== null && !isActive ? 0.35 : 1}
              stroke={isActive ? "#fff" : "none"}
              strokeWidth={isActive ? 0.8 : 0}
              onMouseEnter={() => {
                setLocalHover(r.index);
                onHover(r.index);
              }}
              onMouseLeave={() => {
                setLocalHover(null);
                onHover(null);
              }}
              onClick={() => onSelect(r.index)}
              className="cursor-pointer"
            />
          );
        })}
        <line x1={0} y1={height * (1 - 7.2 / 8)} x2={width} y2={height * (1 - 7.2 / 8)} stroke="#f87171" strokeWidth="0.6" strokeDasharray="3 2" opacity={0.5} />
      </svg>
      <div className="flex justify-between text-[9px] text-slate-600 font-mono mt-1">
        <span>0B</span>
        <span>{Math.round(fileSize / 4).toLocaleString()}B</span>
        <span>{Math.round(fileSize / 2).toLocaleString()}B</span>
        <span>{Math.round((fileSize * 3) / 4).toLocaleString()}B</span>
        <span>{fileSize.toLocaleString()}B</span>
      </div>
    </div>
  );
}
