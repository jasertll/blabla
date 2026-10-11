"use client";

import type { GenomeRegion } from "@/lib/fileGenome";
import { entropyColor } from "./shared";

// Same regions the heatmap shows, plotted as discrete nodes instead of
// a continuous timeline: X = byte offset, Y = entropy, radius = region
// size. This is a genuinely different read of the identical real data —
// the timeline emphasizes "where in the file," this emphasizes
// "clusters of similar regions" the way a scatter plot does that a bar
// chart can't.
export default function EntropyTopology({
  regions,
  fileSize,
  selectedIndex,
  hoveredIndex,
  onSelect,
  onHover,
}: {
  regions: GenomeRegion[];
  fileSize: number;
  selectedIndex: number | null;
  hoveredIndex: number | null;
  onSelect: (i: number) => void;
  onHover: (i: number | null) => void;
}) {
  const width = 500;
  const height = 220;
  const padL = 34;
  const padB = 18;
  const padT = 10;
  const padR = 10;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const maxSize = Math.max(1, ...regions.map((r) => r.endByte - r.startByte));

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[11px] text-slate-400 mb-2">Entropy topology — {regions.length} nodes, node size = region size</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-52">
        {/* axes */}
        <line x1={padL} y1={padT} x2={padL} y2={height - padB} stroke="#334155" strokeWidth="1" />
        <line x1={padL} y1={height - padB} x2={width - padR} y2={height - padB} stroke="#334155" strokeWidth="1" />
        {[0, 2, 4, 6, 8].map((v) => (
          <text key={v} x={padL - 4} y={padT + plotH * (1 - v / 8) + 3} fill="#64748b" fontSize="7" textAnchor="end" fontFamily="monospace">
            {v}
          </text>
        ))}
        <text x={padL + plotW / 2} y={height - 3} fill="#64748b" fontSize="7" textAnchor="middle" fontFamily="monospace">
          byte offset →
        </text>

        {regions.map((r) => {
          const cx = padL + (r.startByte / Math.max(1, fileSize)) * plotW;
          const cy = padT + plotH * (1 - r.entropy / 8);
          const size = r.endByte - r.startByte;
          const radius = 2 + Math.sqrt(size / maxSize) * 7;
          const isActive = selectedIndex === r.index || hoveredIndex === r.index;
          return (
            <circle
              key={r.index}
              cx={cx}
              cy={cy}
              r={isActive ? radius * 1.4 : radius}
              fill={entropyColor(r.entropy)}
              opacity={selectedIndex !== null && !isActive ? 0.3 : 0.85}
              stroke={isActive ? "#fff" : "none"}
              strokeWidth={isActive ? 1 : 0}
              onMouseEnter={() => onHover(r.index)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect(r.index)}
              className="cursor-pointer transition-all"
            />
          );
        })}
      </svg>
    </div>
  );
}
