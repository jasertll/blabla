"use client";

import { useEffect, useRef, useState } from "react";
import { Tag, TagIcon } from "lucide-react";
import type { SurfaceNode, SurfaceEdge, SurfaceNodeType } from "@/lib/ipAttackSurface";
import { lookupPort } from "@/lib/portIntel";
import { ATTACK_TECHNIQUES } from "@/lib/attackData";
import { isTechniqueTagged, setTechniqueTagged } from "@/lib/attackTagging";
import { useInvestigation } from "@/contexts/InvestigationContext";

const TYPE_COLOR: Record<SurfaceNodeType, string> = {
  ip: "#e2e8f0",
  asn: "#a855f7",
  port: "#38bdf8",
  cve: "#f59e0b",
  attack: "#f472b6",
  flag: "#dc2626",
};
const RISK_COLOR: Record<string, string> = { info: "#10b981", notable: "#f59e0b", elevated: "#dc2626" };
const RING_RADIUS: Record<SurfaceNodeType, number> = { ip: 0, asn: 90, flag: 100, port: 150, cve: 210, attack: 270 };

type SimNode = SurfaceNode & { x: number; y: number; vx: number; vy: number; radius: number };

/**
 * A real, physics-laid-out attack-surface map: every node is something
 * this scan actually found (open ports, real CVEs cross-referenced
 * against CISA KEV, the real ATT&CK techniques the curated port table
 * maps to), every edge is a genuine relationship (IP has this port,
 * this port maps to this technique). Hover/click for detail, same
 * evidence-first spirit as File Inspector's graph.
 */
export default function AttackSurfaceMap({ nodes: rawNodes, edges: rawEdges }: { nodes: SurfaceNode[]; edges: SurfaceEdge[] }) {
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);
  const simRef = useRef<SimNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const { addTimelineEvent } = useInvestigation();
  const [tagVersion, setTagVersion] = useState(0);

  useEffect(() => {
    const init: SimNode[] = rawNodes.map((n, i) => {
      const ring = RING_RADIUS[n.type];
      const angle = (i / Math.max(1, rawNodes.length)) * Math.PI * 2;
      return {
        ...n,
        x: Math.cos(angle) * ring,
        y: Math.sin(angle) * ring,
        vx: 0,
        vy: 0,
        radius: n.type === "ip" ? 20 : n.type === "port" ? 11 : 9,
      };
    });
    simRef.current = init;
    setSimNodes(init);

    const byId = new Map(init.map((n) => [n.id, n]));
    const simEdges = rawEdges.map((e) => ({ source: byId.get(e.source)!, target: byId.get(e.target)! })).filter((e) => e.source && e.target);

    let raf = 0;
    let stopped = false;
    let ticks = 0;
    const MAX_TICKS = 260; // settles then stops, no need to spin forever

    function step() {
      if (stopped) return;
      const arr = simRef.current;
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i];
          const b = arr[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = dx * dx + dy * dy + 20;
          const dist = Math.sqrt(distSq);
          const force = 1400 / distSq;
          const fx = (force * dx) / dist;
          const fy = (force * dy) / dist;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }
      for (const e of simEdges) {
        const dx = e.target.x - e.source.x;
        const dy = e.target.y - e.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const f = (dist - 55) * 0.025;
        const fx = (f * dx) / dist;
        const fy = (f * dy) / dist;
        e.source.vx += fx; e.source.vy += fy;
        e.target.vx -= fx; e.target.vy -= fy;
      }
      const ipNode = arr.find((n) => n.type === "ip");
      for (const n of arr) {
        if (ipNode && n !== ipNode) {
          const dx = n.x - ipNode.x;
          const dy = n.y - ipNode.y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
          const target = RING_RADIUS[n.type];
          const f = (target - dist) * 0.01;
          n.vx += (f * dx) / dist;
          n.vy += (f * dy) / dist;
        }
        n.vx -= n.x * 0.001;
        n.vy -= n.y * 0.001;
        n.vx *= 0.8;
        n.vy *= 0.8;
        n.x += n.vx;
        n.y += n.vy;
      }
      setSimNodes([...arr]);
      ticks++;
      if (ticks < MAX_TICKS) raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [rawNodes, rawEdges]);

  if (rawNodes.length <= 1) {
    return <div className="rounded-lg border border-border p-6 text-center text-xs text-slate-500">Not enough real data returned for this target to build an attack-surface map.</div>;
  }

  const width = 640;
  const height = 420;
  const cx = width / 2;
  const cy = height / 2;
  const neighbors = new Map<string, Set<string>>();
  for (const e of rawEdges) {
    if (!neighbors.has(e.source)) neighbors.set(e.source, new Set());
    if (!neighbors.has(e.target)) neighbors.set(e.target, new Set());
    neighbors.get(e.source)!.add(e.target);
    neighbors.get(e.target)!.add(e.source);
  }
  const focusId = selectedId ?? hoveredId;
  const focusNeighbors = focusId ? neighbors.get(focusId) : null;
  const byId = new Map(simNodes.map((n) => [n.id, n]));
  const selectedNode = selectedId ? byId.get(selectedId) : null;
  const selectedTechnique = selectedNode?.type === "attack" ? ATTACK_TECHNIQUES.find((t) => `attack-${t.id}` === selectedNode.id) : null;

  function toggleTag() {
    if (!selectedTechnique) return;
    const next = !isTechniqueTagged(selectedTechnique.id);
    setTechniqueTagged(selectedTechnique.id, next);
    setTagVersion((v) => v + 1);
    if (next) addTimelineEvent({ tool: "ip", label: "ATT&CK technique tagged from attack-surface map", detail: `${selectedTechnique.id} — ${selectedTechnique.name}` });
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[11px] text-slate-400 mb-2">Attack surface map — every node is real (open ports, real CVEs cross-checked against CISA KEV, real ATT&CK mappings)</p>
      <div className="flex flex-col md:flex-row gap-3">
        <svg viewBox={`0 0 ${width} ${height}`} className="flex-1 rounded-lg bg-[#05040a] border border-border/60" style={{ minHeight: 340 }}>
          {rawEdges.map((e, i) => {
            const s = byId.get(e.source);
            const t = byId.get(e.target);
            if (!s || !t) return null;
            const touches = focusId !== null && (e.source === focusId || e.target === focusId);
            const dim = focusId !== null && !touches;
            return (
              <line
                key={i}
                x1={s.x + cx}
                y1={s.y + cy}
                x2={t.x + cx}
                y2={t.y + cy}
                stroke={touches ? "#ffffff" : "#475569"}
                strokeWidth={touches ? 1.4 : 0.7}
                opacity={dim ? 0.08 : touches ? 0.85 : 0.3}
              />
            );
          })}
          {simNodes.map((n) => {
            const isFocus = n.id === focusId;
            const isNeighbor = focusId !== null && focusNeighbors?.has(n.id);
            const dim = focusId !== null && !isFocus && !isNeighbor;
            const color = n.type === "port" || n.type === "flag" ? RISK_COLOR[n.risk ?? "info"] : n.type === "cve" && n.isKev ? "#dc2626" : TYPE_COLOR[n.type];
            const r = isFocus ? n.radius * 1.3 : n.radius;
            return (
              <g
                key={n.id}
                onMouseEnter={() => setHoveredId(n.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => setSelectedId(n.id === selectedId ? null : n.id)}
                className="cursor-pointer"
                opacity={dim ? 0.2 : 1}
              >
                {n.isKev && (
                  <circle cx={n.x + cx} cy={n.y + cy} r={r + 5} fill="none" stroke="#dc2626" strokeWidth={1} opacity={0.6}>
                    <animate attributeName="r" values={`${r + 3};${r + 8};${r + 3}`} dur="1.6s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.6;0.1;0.6" dur="1.6s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle cx={n.x + cx} cy={n.y + cy} r={r} fill={color} stroke={isFocus ? "#fff" : "rgba(255,255,255,0.25)"} strokeWidth={isFocus ? 1.5 : 0.8} />
                {(dim === false || isFocus) && (
                  <text x={n.x + cx} y={n.y + cy + r + 11} fill={isFocus ? "#fff" : "#94a3b8"} fontSize={9} textAnchor="middle" fontFamily="monospace">
                    {n.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        <div className="md:w-56 shrink-0">
          {selectedNode ? (
            <div className="rounded-lg border border-accent/40 bg-panel/90 p-3 text-[11px] space-y-1.5">
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">{selectedNode.type}</p>
              <p className="text-slate-100 font-medium break-words">{selectedNode.label}</p>
              {selectedNode.detail && <p className="text-slate-400">{selectedNode.detail}</p>}
              {selectedNode.type === "port" && (
                <p className="text-slate-400">{lookupPort(Number(selectedNode.label.replace(":", ""))).note}</p>
              )}
              {selectedNode.isKev && <p className="text-red-300 font-semibold">CISA KEV: actively exploited in the wild</p>}
              {selectedTechnique && (
                <>
                  <p className="text-slate-500">{selectedTechnique.tactic}</p>
                  <p className="text-slate-400">{selectedTechnique.description}</p>
                  <button
                    onClick={toggleTag}
                    className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border mt-1 ${
                      isTechniqueTagged(selectedTechnique.id) ? "border-accent bg-accent/20 text-accent-glow" : "border-border text-slate-400 hover:border-accent/50"
                    }`}
                  >
                    {isTechniqueTagged(selectedTechnique.id) ? <TagIcon className="h-3 w-3" /> : <Tag className="h-3 w-3" />}
                    {isTechniqueTagged(selectedTechnique.id) ? "Tagged" : "Tag in ATT&CK Mapper"}
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-border p-3 text-[11px] text-slate-500">Hover or click a node for detail. Pulsing red rings mark CVEs confirmed on CISA's actively-exploited (KEV) catalog.</div>
          )}
          <div className="mt-2 space-y-1 text-[10px] text-slate-500">
            <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLOR.ip }} /> host</p>
            <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: RISK_COLOR.elevated }} /> elevated-risk port/flag</p>
            <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLOR.cve }} /> CVE</p>
            <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLOR.attack }} /> ATT&CK technique</p>
          </div>
        </div>
      </div>
    </div>
  );
}
