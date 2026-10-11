"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Tag, TagIcon } from "lucide-react";
import type { Verdict, Severity } from "@/lib/fileAnalysis";
import type { PeInfo } from "@/lib/peAnalysis";
import type { ElfInfo } from "@/lib/elfAnalysis";
import type { MacroExtractionResult } from "@/lib/macroAnalysis";
import { buildEvidenceGraph, type EvidenceNode, type EvidenceNodeType } from "@/lib/evidenceGraph";
import { ATTACK_TECHNIQUES } from "@/lib/attackData";
import { isTechniqueTagged, setTechniqueTagged } from "@/lib/attackTagging";
import { useInvestigation } from "@/contexts/InvestigationContext";

const TYPE_COLOR: Record<EvidenceNodeType, string> = {
  file: "#e2e8f0",
  hash: "#94a3b8",
  section: "#10b981",
  import: "#a855f7",
  api: "#38bdf8",
  string: "#3b82f6",
  ioc: "#3b82f6",
  yara: "#eab308",
  finding: "#f59e0b",
  attack: "#f472b6",
};
const SEVERITY_COLOR: Record<Severity, string> = { danger: "#dc2626", warning: "#f59e0b", info: "#38bdf8", safe: "#10b981" };
const RING_RADIUS: Record<EvidenceNodeType, number> = {
  file: 0,
  hash: 85,
  section: 130,
  import: 150,
  api: 220,
  string: 190,
  ioc: 250,
  yara: 260,
  finding: 300,
  attack: 380,
};

type SimNode = EvidenceNode & { x: number; y: number; vx: number; vy: number; radius: number; pinned: boolean };
type SimEdge = { source: SimNode; target: SimNode };

function drawShape(ctx: CanvasRenderingContext2D, type: EvidenceNodeType, x: number, y: number, r: number) {
  ctx.beginPath();
  if (type === "file") {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
  } else if (type === "attack") {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
  } else if (type === "hash") {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
  } else if (type === "section") {
    ctx.rect(x - r, y - r, r * 2, r * 2);
  } else if (type === "string" || type === "ioc") {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.9, y + r * 0.7);
    ctx.lineTo(x - r * 0.9, y + r * 0.7);
  } else if (type === "yara") {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const a2 = ((i + 0.5) / 5) * Math.PI * 2 - Math.PI / 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      const px2 = x + Math.cos(a2) * r * 0.45;
      const py2 = y + Math.sin(a2) * r * 0.45;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      ctx.lineTo(px2, py2);
    }
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.closePath();
}

export default function EvidenceGraph({
  fileName,
  overallSeverity,
  verdicts,
  interestingStrings,
  peInfo,
  elfInfo,
  macroResult,
}: {
  fileName: string;
  overallSeverity: Severity;
  verdicts: Verdict[];
  interestingStrings: string[];
  peInfo: PeInfo | null;
  elfInfo: ElfInfo | null;
  macroResult: MacroExtractionResult | null;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const [hoveredNode, setHoveredNode] = useState<EvidenceNode | null>(null);
  const [tagRefresh, setTagRefresh] = useState(0);
  const { addTimelineEvent } = useInvestigation();

  const graphRef = useRef(buildEvidenceGraph({ fileName, overallSeverity, verdicts, interestingStrings, peInfo, elfInfo, macroResult }));
  graphRef.current = buildEvidenceGraph({ fileName, overallSeverity, verdicts, interestingStrings, peInfo, elfInfo, macroResult });

  useEffect(() => {
    const mountEl = mountRef.current;
    const canvas = canvasRef.current;
    if (!mountEl || !canvas) return;
    const mount = mountEl as HTMLDivElement;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    const ctx = ctx2d as CanvasRenderingContext2D;

    const { nodes: rawNodes, edges: rawEdges } = graphRef.current;
    const simNodes: SimNode[] = rawNodes.map((n, i) => {
      const ring = RING_RADIUS[n.type];
      const angle = (i / Math.max(1, rawNodes.length)) * Math.PI * 2 + Math.random() * 0.3;
      return {
        ...n,
        x: Math.cos(angle) * ring,
        y: Math.sin(angle) * ring,
        vx: 0,
        vy: 0,
        radius: n.type === "file" ? 22 : 6 + Math.min(10, n.weight * 1.8),
        pinned: false,
      };
    });
    const byId = new Map(simNodes.map((n) => [n.id, n]));
    const simEdges: SimEdge[] = rawEdges.map((e) => ({ source: byId.get(e.source)!, target: byId.get(e.target)! })).filter((e) => e.source && e.target);
    const neighbors = new Map<string, Set<string>>();
    for (const e of simEdges) {
      if (!neighbors.has(e.source.id)) neighbors.set(e.source.id, new Set());
      if (!neighbors.has(e.target.id)) neighbors.set(e.target.id, new Set());
      neighbors.get(e.source.id)!.add(e.target.id);
      neighbors.get(e.target.id)!.add(e.source.id);
    }

    // Ambient background particles — decorative depth only, not data.
    const particles = Array.from({ length: 140 }, () => ({ x: (Math.random() - 0.5) * 2000, y: (Math.random() - 0.5) * 1400, r: 0.4 + Math.random() * 1.1, phase: Math.random() * Math.PI * 2 }));

    let width = mount.clientWidth;
    let height = mount.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      width = mount.clientWidth;
      height = mount.clientHeight;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    const camera = { x: 0, y: 0, zoom: 1 };
    const cameraTarget = { x: 0, y: 0, zoom: 1 };

    function toWorld(sx: number, sy: number) {
      return { x: (sx - width / 2) / camera.zoom + camera.x, y: (sy - height / 2) / camera.zoom + camera.y };
    }
    function toScreen(wx: number, wy: number) {
      return { x: (wx - camera.x) * camera.zoom + width / 2, y: (wy - camera.y) * camera.zoom + height / 2 };
    }

    let dragNode: SimNode | null = null;
    let panning = false;
    let dragDistance = 0;
    let lastMouse = { x: 0, y: 0 };
    let hoveredLocal: SimNode | null = null;

    function nodeAtScreen(sx: number, sy: number): SimNode | null {
      const w = toWorld(sx, sy);
      let closest: SimNode | null = null;
      let closestDist = Infinity;
      for (const n of simNodes) {
        const d = Math.hypot(n.x - w.x, n.y - w.y);
        if (d < n.radius + 6 && d < closestDist) {
          closest = n;
          closestDist = d;
        }
      }
      return closest;
    }

    function onPointerDown(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      lastMouse = { x: sx, y: sy };
      dragDistance = 0;
      const hit = nodeAtScreen(sx, sy);
      if (hit) {
        dragNode = hit;
        hit.pinned = true;
      } else {
        panning = true;
      }
    }
    function onPointerMove(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (dragNode) {
        const w = toWorld(sx, sy);
        dragNode.x = w.x;
        dragNode.y = w.y;
        dragNode.vx = 0;
        dragNode.vy = 0;
        dragDistance += Math.hypot(sx - lastMouse.x, sy - lastMouse.y);
      } else if (panning) {
        cameraTarget.x -= (sx - lastMouse.x) / camera.zoom;
        cameraTarget.y -= (sy - lastMouse.y) / camera.zoom;
        camera.x = cameraTarget.x;
        camera.y = cameraTarget.y;
        dragDistance += Math.hypot(sx - lastMouse.x, sy - lastMouse.y);
      } else {
        hoveredLocal = nodeAtScreen(sx, sy);
      }
      lastMouse = { x: sx, y: sy };
    }
    function onPointerUp(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (dragNode) {
        dragNode.pinned = false;
        if (dragDistance < 5) {
          const clicked = dragNode;
          selectedIdRef.current = clicked.id;
          setSelectedId(clicked.id);
          cameraTarget.x = clicked.x;
          cameraTarget.y = clicked.y;
          cameraTarget.zoom = 1.8;
        }
        dragNode = null;
      } else if (panning) {
        panning = false;
        if (dragDistance < 5) {
          // Clicked empty space: clear focus, return to overview.
          selectedIdRef.current = null;
          setSelectedId(null);
          cameraTarget.x = 0;
          cameraTarget.y = 0;
          cameraTarget.zoom = 1;
        }
      }
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const before = toWorld(sx, sy);
      cameraTarget.zoom = Math.min(3.2, Math.max(0.35, cameraTarget.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
      camera.zoom = cameraTarget.zoom;
      const after = toWorld(sx, sy);
      cameraTarget.x += before.x - after.x;
      camera.x = cameraTarget.x;
      cameraTarget.y += before.y - after.y;
      camera.y = cameraTarget.y;
    }
    function onLeave() {
      hoveredLocal = null;
    }
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerleave", onLeave);

    let raf = 0;
    let stopped = false;
    let lastHoverReport: EvidenceNode | null = null;
    const start = performance.now();

    // Node count scales the physics constants down a touch so dense
    // graphs (many imports/functions/findings) still settle instead of
    // jittering forever.
    const n = simNodes.length;
    const REPULSION = n > 80 ? 1800 : 2600;
    const SPRING_K = 0.02;
    const EDGE_LEN = 60;
    const RADIAL_K = 0.008;
    const CENTER_K = 0.0006;

    function physicsStep() {
      for (let i = 0; i < simNodes.length; i++) {
        for (let j = i + 1; j < simNodes.length; j++) {
          const a = simNodes[i];
          const b = simNodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = dx * dx + dy * dy + 30;
          const dist = Math.sqrt(distSq);
          const force = REPULSION / distSq;
          const fx = (force * dx) / dist;
          const fy = (force * dy) / dist;
          if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
          if (!b.pinned) { b.vx += fx; b.vy += fy; }
        }
      }
      for (const e of simEdges) {
        const dx = e.target.x - e.source.x;
        const dy = e.target.y - e.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const f = (dist - EDGE_LEN) * SPRING_K;
        const fx = (f * dx) / dist;
        const fy = (f * dy) / dist;
        if (!e.source.pinned) { e.source.vx += fx; e.source.vy += fy; }
        if (!e.target.pinned) { e.target.vx -= fx; e.target.vy -= fy; }
      }
      const file = simNodes.find((n) => n.type === "file");
      for (const node of simNodes) {
        if (node.pinned) continue;
        if (file && node !== file) {
          const dx = node.x - file.x;
          const dy = node.y - file.y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
          const target = RING_RADIUS[node.type];
          const f = (target - dist) * RADIAL_K;
          node.vx += (f * dx) / dist;
          node.vy += (f * dy) / dist;
        }
        node.vx -= node.x * CENTER_K;
        node.vy -= node.y * CENTER_K;
        node.vx *= 0.82;
        node.vy *= 0.82;
        node.x += node.vx;
        node.y += node.vy;
      }
    }

    function draw(now: number) {
      if (stopped) return;
      raf = requestAnimationFrame(draw);
      const t = (now - start) / 1000;
      physicsStep();

      camera.x += (cameraTarget.x - camera.x) * 0.12;
      camera.y += (cameraTarget.y - camera.y) * 0.12;
      camera.zoom += (cameraTarget.zoom - camera.zoom) * 0.12;

      ctx.clearRect(0, 0, width, height);

      // Background particles, gently drifting.
      ctx.fillStyle = "rgba(148,163,184,0.35)";
      for (const p of particles) {
        const s = toScreen(p.x, p.y);
        const tw = 0.5 + Math.sin(t * 0.5 + p.phase) * 0.3;
        ctx.globalAlpha = Math.max(0, tw) * 0.4;
        ctx.beginPath();
        ctx.arc(s.x, s.y, p.r * camera.zoom, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const selected = selectedIdRef.current;
      const focusId = selected ?? hoveredLocal?.id ?? null;
      const focusNeighbors = focusId ? neighbors.get(focusId) : null;

      // Edges.
      for (const e of simEdges) {
        const p0 = toScreen(e.source.x, e.source.y);
        const p1 = toScreen(e.target.x, e.target.y);
        const touchesFocus = focusId !== null && (e.source.id === focusId || e.target.id === focusId);
        const dim = focusId !== null && !touchesFocus;
        ctx.strokeStyle = touchesFocus ? "#ffffff" : "#475569";
        ctx.globalAlpha = dim ? 0.06 : touchesFocus ? 0.85 : 0.28;
        ctx.lineWidth = touchesFocus ? 1.4 : 0.7;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();

        if (touchesFocus) {
          const phase = (t * 0.6) % 1;
          const px = p0.x + (p1.x - p0.x) * phase;
          const py = p0.y + (p1.y - p0.y) * phase;
          ctx.fillStyle = "#ffffff";
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(px, py, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // Nodes.
      const showAllLabels = simNodes.length <= 24;
      for (const node of simNodes) {
        const p = toScreen(node.x, node.y);
        const isFocus = node.id === focusId;
        const isNeighborOfFocus = focusId !== null && focusNeighbors?.has(node.id);
        const dim = focusId !== null && !isFocus && !isNeighborOfFocus;
        const color = node.type === "finding" && node.severity ? SEVERITY_COLOR[node.severity] : TYPE_COLOR[node.type];
        const r = (isFocus ? node.radius * 1.3 : node.radius) * Math.min(1.4, Math.max(0.6, camera.zoom));

        ctx.globalAlpha = dim ? 0.15 : 1;
        if (isFocus) {
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.4);
          grad.addColorStop(0, `${color}55`);
          grad.addColorStop(1, `${color}00`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = color;
        drawShape(ctx, node.type, p.x, p.y, r);
        ctx.fill();
        ctx.strokeStyle = isFocus ? "#ffffff" : "rgba(255,255,255,0.2)";
        ctx.lineWidth = isFocus ? 1.5 : 0.8;
        ctx.stroke();

        if (!dim && (showAllLabels || isFocus || isNeighborOfFocus || camera.zoom > 1.3)) {
          ctx.fillStyle = isFocus ? "#ffffff" : "#94a3b8";
          ctx.font = `${isFocus ? "bold " : ""}${Math.max(8, 9 * Math.min(1.3, camera.zoom))}px monospace`;
          ctx.textAlign = "center";
          ctx.fillText(node.label, p.x, p.y + r + 11);
        }
      }
      ctx.globalAlpha = 1;

      if (hoveredLocal !== lastHoverReport) {
        lastHoverReport = hoveredLocal;
        setHoveredNode(hoveredLocal ? { ...hoveredLocal } : null);
      }
    }
    raf = requestAnimationFrame(draw);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerleave", onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName, overallSeverity, verdicts, interestingStrings, peInfo, elfInfo, macroResult]);

  const selectedNode = selectedId ? graphRef.current.nodes.find((n) => n.id === selectedId) ?? null : null;
  const selectedVerdict = selectedNode && (selectedNode.type === "finding" || selectedNode.type === "yara") ? verdicts.find((v) => `finding-${v.id}` === selectedNode.id) ?? null : null;
  const selectedTechnique = selectedNode?.type === "attack" ? ATTACK_TECHNIQUES.find((t) => `attack-${t.id}` === selectedNode.id) ?? null : null;
  const selectedNeighborLabels = selectedNode
    ? graphRef.current.edges
        .filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
        .map((e) => graphRef.current.nodes.find((n) => n.id === (e.source === selectedNode.id ? e.target : e.source))?.label)
        .filter((x): x is string => !!x)
    : [];

  function toggleTag() {
    if (!selectedTechnique) return;
    const next = !isTechniqueTagged(selectedTechnique.id);
    setTechniqueTagged(selectedTechnique.id, next);
    setTagRefresh((v) => v + 1);
    if (next) addTimelineEvent({ tool: "file", label: "ATT&CK technique tagged from evidence graph", detail: `${selectedTechnique.id} — ${selectedTechnique.name}` });
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden relative" style={{ height: 460 }}>
      <div ref={mountRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      </div>

      <div className="absolute top-2 left-2 text-[10px] text-slate-500 hud-text pointer-events-none max-w-[260px]">
        Evidence graph — every node is real (drag to reposition, scroll to zoom, click to focus)
      </div>

      {hoveredNode && !selectedId && (
        <div className="absolute bottom-2 left-2 rounded-md border border-border bg-panel/90 backdrop-blur-sm px-2 py-1 text-[10px] text-slate-300 pointer-events-none">
          {hoveredNode.type.toUpperCase()} · {hoveredNode.label}
        </div>
      )}

      {selectedNode && (
        <div className="absolute top-2 right-2 bottom-2 w-64 rounded-lg border border-accent/40 bg-panel/95 backdrop-blur-sm p-3 overflow-y-auto text-[11px]">
          <button onClick={() => setSelectedId(null)} className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 mb-2">
            <ArrowLeft className="h-3 w-3" /> Back to full graph
          </button>
          <p className="text-[9px] text-slate-500 uppercase tracking-wide">{selectedNode.type}</p>
          <p className="text-slate-100 font-medium mt-0.5 break-words">{selectedNode.label}</p>
          {selectedNode.detail && <p className="text-slate-400 mt-1">{selectedNode.detail}</p>}

          {selectedVerdict && (
            <div className="mt-2 pt-2 border-t border-border space-y-1.5">
              <p className="text-slate-400"><span className="text-slate-500">Why it matters:</span> {selectedVerdict.explanation}</p>
              <p className="text-slate-400"><span className="text-slate-500">Recommended:</span> {selectedVerdict.recommendation}</p>
            </div>
          )}

          {selectedTechnique && (
            <div className="mt-2 pt-2 border-t border-border space-y-1.5">
              <p className="text-slate-500">{selectedTechnique.tactic}</p>
              <p className="text-slate-400">{selectedTechnique.description}</p>
              <button
                onClick={toggleTag}
                className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border mt-1 ${
                  isTechniqueTagged(selectedTechnique.id) ? "border-accent bg-accent/20 text-accent-glow" : "border-border text-slate-400 hover:border-accent/50"
                }`}
              >
                {isTechniqueTagged(selectedTechnique.id) ? <TagIcon className="h-3 w-3" /> : <Tag className="h-3 w-3" />}
                {isTechniqueTagged(selectedTechnique.id) ? "Tagged in ATT&CK Mapper" : "Tag in ATT&CK Mapper"}
              </button>
            </div>
          )}

          {selectedNeighborLabels.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border">
              <p className="text-slate-500 mb-1">Direct connections ({selectedNeighborLabels.length})</p>
              <div className="space-y-0.5">
                {selectedNeighborLabels.slice(0, 15).map((l, i) => (
                  <p key={i} className="text-slate-400 font-mono text-[10px] break-words">{l}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
