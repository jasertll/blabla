"use client";

import { useEffect, useRef } from "react";
import { GlobeStats } from "@/lib/threatGlobeData";

// The "neural" alternate visualization for ThreatGlobe: the same real
// CISA KEV + NVD data, laid out as an honest feedforward network instead
// of a rotating particle storm. Input nodes = real catalog entries,
// hidden nodes = the same 7 severity clusters ThreatGlobe's classic mode
// uses, output node = a single composite threat score computed directly
// from the fetched stats (formula documented at computeThreatLevel below)
// — nothing here is decorative filler standing in for data, unlike the
// classic mode's 14 unlabeled decorative comets.

type Severity = "CRITICAL" | "HIGH" | "KEV-LISTED" | "MONITORED" | "BASELINE" | "RANSOMWARE" | "EXPOSED";

const CLUSTER_ORDER: Severity[] = ["CRITICAL", "HIGH", "KEV-LISTED", "MONITORED", "BASELINE", "RANSOMWARE", "EXPOSED"];

const CLUSTER_COLORS: Record<Severity, string> = {
  CRITICAL: "#dc2626",
  HIGH: "#f59e0b",
  "KEV-LISTED": "#9333ea",
  MONITORED: "#22d3ee",
  BASELINE: "#10b981",
  RANSOMWARE: "#f472b6",
  EXPOSED: "#facc15",
};

type InputNode = { label: string; sub: string; cluster: Severity };

function classifyKev(k: GlobeStats["kevList"][number]): Severity {
  return k.ransomware ? "RANSOMWARE" : "KEV-LISTED";
}

function classifyCve(c: GlobeStats["cveList"][number]): Severity {
  if (c.score === null) return "MONITORED";
  if (c.score >= 9) return "CRITICAL";
  if (c.score >= 7) return "HIGH";
  return "BASELINE";
}

function buildInputNodes(stats: GlobeStats | null): InputNode[] {
  const nodes: InputNode[] = [];
  if (stats) {
    for (const k of stats.kevList.slice(0, 9)) {
      nodes.push({ label: k.id, sub: k.product, cluster: classifyKev(k) });
    }
    for (const c of stats.cveList.slice(0, 6)) {
      if (c.score === null) continue;
      nodes.push({ label: c.id, sub: `CVSS ${c.score}`, cluster: classifyCve(c) });
    }
  }
  return nodes.slice(0, 14);
}

// A 0-100 composite derived only from real fetched numbers, weighted so
// the score is traceable rather than a vibe: 40% the ransomware-linked
// share of the KEV catalogue, 30% the single highest CVSS score seen,
// 30% the critical-severity share of the KEV catalogue.
function computeThreatLevel(stats: GlobeStats | null): number {
  if (!stats || stats.totalKev === 0) return 0;
  const ransomwareShare = stats.ransomwareCount / stats.totalKev;
  const criticalShare = stats.totalCritical / stats.totalKev;
  const cvssPart = stats.highestCve ? stats.highestCve.score / 10 : 0;
  const score = ransomwareShare * 40 + cvssPart * 30 + criticalShare * 30;
  return Math.round(Math.min(100, Math.max(0, score)));
}

export default function ThreatNeuralView({ stats }: { stats: GlobeStats | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    // Cast away null explicitly (rather than relying on narrowing) since
    // TS doesn't carry the above null-check's narrowing into the nested
    // `draw` function below.
    const ctx = ctx2d as CanvasRenderingContext2D;

    let raf = 0;
    let stopped = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const inputNodes = buildInputNodes(stats);
    const threatLevel = computeThreatLevel(stats);
    const activation = CLUSTER_ORDER.reduce((acc, c) => {
      acc[c] = 0;
      return acc;
    }, {} as Record<Severity, number>);
    inputNodes.forEach((node) => {
      activation[node.cluster]++;
    });
    const maxActivation = Math.max(1, ...Object.values(activation));

    function resize() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    const start = performance.now();
    const layerFrac = [0.14, 0.5, 0.86];

    function draw(now: number) {
      if (stopped) return;
      raf = requestAnimationFrame(draw);
      const t = (now - start) / 1000;
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      if (w === 0 || h === 0) return;
      ctx.clearRect(0, 0, w, h);

      const n = inputNodes.length || 1;
      const inputPositions = inputNodes.map((_, i) => ({
        x: layerFrac[0] * w,
        y: (h / (n + 1)) * (i + 1),
      }));
      const hiddenPositions = CLUSTER_ORDER.map((_, i) => ({
        x: layerFrac[1] * w,
        y: (h / (CLUSTER_ORDER.length + 1)) * (i + 1),
      }));
      const outputPos = { x: layerFrac[2] * w, y: h / 2 };

      // input -> hidden edges, one per real entry, plus a traveling pulse
      inputNodes.forEach((node, i) => {
        const hi = CLUSTER_ORDER.indexOf(node.cluster);
        const p0 = inputPositions[i];
        const p1 = hiddenPositions[hi];
        const color = CLUSTER_COLORS[node.cluster];

        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.18;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
        ctx.globalAlpha = 1;

        const phase = (t * 0.4 + i * 0.13) % 1;
        const px = p0.x + (p1.x - p0.x) * phase;
        const py = p0.y + (p1.y - p0.y) * phase;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, Math.PI * 2);
        ctx.fill();
      });

      // hidden -> output edges, only for clusters real data actually hit
      CLUSTER_ORDER.forEach((cluster, hi) => {
        const act = activation[cluster];
        if (act === 0) return;
        const p0 = hiddenPositions[hi];
        const color = CLUSTER_COLORS[cluster];
        const strength = act / maxActivation;

        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.15 + strength * 0.35;
        ctx.lineWidth = 1 + strength * 2;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(outputPos.x, outputPos.y);
        ctx.stroke();
        ctx.globalAlpha = 1;

        const phase = (t * 0.55 + hi * 0.2) % 1;
        const px = p0.x + (outputPos.x - p0.x) * phase;
        const py = p0.y + (outputPos.y - p0.y) * phase;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, 2.6, 0, Math.PI * 2);
        ctx.fill();
      });

      // input nodes
      ctx.textBaseline = "middle";
      inputNodes.forEach((node, i) => {
        const p = inputPositions[i];
        const color = CLUSTER_COLORS[node.cluster];
        const pulse = 1 + Math.sin(t * 2 + i) * 0.15;

        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 12);
        grad.addColorStop(0, `${color}66`);
        grad.addColorStop(1, `${color}00`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4 * pulse, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#cbd5e1";
        ctx.font = "9px monospace";
        ctx.textAlign = "left";
        ctx.fillText(node.label, p.x + 10, p.y);
      });

      // hidden nodes (the 7 severity clusters)
      CLUSTER_ORDER.forEach((cluster, hi) => {
        const p = hiddenPositions[hi];
        const color = CLUSTER_COLORS[cluster];
        const act = activation[cluster];
        const strength = act / maxActivation;
        const pulse = 1 + Math.sin(t * 1.5 + hi) * (0.1 + strength * 0.2);

        ctx.fillStyle = color;
        ctx.globalAlpha = act > 0 ? 0.4 + strength * 0.6 : 0.18;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (6 + strength * 5) * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.fillStyle = "#94a3b8";
        ctx.font = "9px monospace";
        ctx.textAlign = "center";
        ctx.fillText(cluster, p.x, p.y + 18);
      });

      // output node — the composite threat level
      const outPulse = 1 + Math.sin(t * 2.4) * 0.1;
      const outColor = threatLevel >= 70 ? "#dc2626" : threatLevel >= 40 ? "#f59e0b" : "#10b981";

      const grad2 = ctx.createRadialGradient(outputPos.x, outputPos.y, 0, outputPos.x, outputPos.y, 30);
      grad2.addColorStop(0, `${outColor}aa`);
      grad2.addColorStop(1, `${outColor}00`);
      ctx.fillStyle = grad2;
      ctx.beginPath();
      ctx.arc(outputPos.x, outputPos.y, 30, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = outColor;
      ctx.beginPath();
      ctx.arc(outputPos.x, outputPos.y, 10 * outPulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${threatLevel}`, outputPos.x, outputPos.y);
      ctx.font = "9px monospace";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText("THREAT LEVEL", outputPos.x, outputPos.y + 24);
    }

    raf = requestAnimationFrame(draw);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [stats]);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
}
