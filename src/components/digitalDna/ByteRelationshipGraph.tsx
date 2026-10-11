"use client";

import type { GenomeRegion, RelationshipEdge } from "@/lib/fileGenome";
import { entropyColor } from "./shared";

// A radial layout (not a force simulation — deterministic, so it never
// jitters or reflows as you interact with it) connecting each region to
// its few closest entropy-neighbors. This is explicitly NOT a "neural
// network" — there's no learned weighting here, just real pairwise
// entropy-distance, computed once in lib/fileGenome.ts's
// buildRelationshipEdges() and drawn as-is.
export default function ByteRelationshipGraph({
  regions,
  edges,
  selectedIndex,
  hoveredIndex,
  onSelect,
  onHover,
}: {
  regions: GenomeRegion[];
  edges: RelationshipEdge[];
  selectedIndex: number | null;
  hoveredIndex: number | null;
  onSelect: (i: number) => void;
  onHover: (i: number | null) => void;
}) {
  const size = 460;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.4;

  const posByIndex = new Map<number, { x: number; y: number }>();
  regions.forEach((region, i) => {
    const angle = (i / regions.length) * Math.PI * 2 - Math.PI / 2;
    posByIndex.set(region.index, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  });

  const activeIndex = selectedIndex ?? hoveredIndex;

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[11px] text-slate-400 mb-2">Byte relationship graph — edges link regions with similar real entropy, not a learned model</p>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-64">
        {edges.map((e, i) => {
          const p0 = posByIndex.get(e.a);
          const p1 = posByIndex.get(e.b);
          if (!p0 || !p1) return null;
          const touchesActive = activeIndex !== null && (e.a === activeIndex || e.b === activeIndex);
          return (
            <line
              key={i}
              x1={p0.x}
              y1={p0.y}
              x2={p1.x}
              y2={p1.y}
              stroke={touchesActive ? "#fff" : "#64748b"}
              strokeWidth={touchesActive ? 1.2 : 0.5}
              opacity={touchesActive ? 0.8 : 0.18 + e.strength * 0.2}
            />
          );
        })}
        {regions.map((region) => {
          const p = posByIndex.get(region.index)!;
          const isActive = selectedIndex === region.index || hoveredIndex === region.index;
          return (
            <circle
              key={region.index}
              cx={p.x}
              cy={p.y}
              r={isActive ? 6.5 : 4}
              fill={entropyColor(region.entropy)}
              stroke={isActive ? "#fff" : "none"}
              strokeWidth={isActive ? 1 : 0}
              opacity={activeIndex !== null && !isActive ? 0.35 : 0.9}
              onMouseEnter={() => onHover(region.index)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect(region.index)}
              className="cursor-pointer transition-all"
            />
          );
        })}
      </svg>
    </div>
  );
}
