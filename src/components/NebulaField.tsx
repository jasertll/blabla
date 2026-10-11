"use client";

import { useEffect, useRef } from "react";

// A dense, multi-colored twinkling particle field with a warm glowing
// core — the "cosmic nebula" backdrop styled after the reference mood
// board (a business-AI dashboard demo with a galaxy-like neural map).
// Pure decorative canvas layer, absolutely positioned behind whatever
// content sits on top of it. Reused behind both the Intelligence Graph
// and (via the same visual language, built directly into the WebGL scene
// instead) the Satellite Tracker.
const PALETTE = ["#ffffff", "#93c5fd", "#f472b6", "#d8b4fe", "#fbbf24", "#5eead4", "#e879f9"];

type Particle = { x: number; y: number; r: number; color: string; alphaBase: number; phase: number };

export default function NebulaField({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !parent || !ctx) return;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let stopped = false;
    let particles: Particle[] = [];
    let w = 0, h = 0;

    function seed() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = parent!.getBoundingClientRect();
      w = canvas!.width = Math.max(1, Math.floor(rect.width * dpr));
      h = canvas!.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas!.style.width = `${rect.width}px`;
      canvas!.style.height = `${rect.height}px`;

      const count = Math.min(1400, Math.floor((w * h) / 3800));
      const cx = w / 2, cy = h / 2;
      particles = Array.from({ length: count }, () => {
        const angle = Math.random() * Math.PI * 2;
        const rad = Math.pow(Math.random(), 1.7) * Math.max(w, h) * 0.58;
        return {
          x: cx + Math.cos(angle) * rad,
          y: cy + Math.sin(angle) * rad * 0.8,
          r: (0.5 + Math.random() * 1.6) * dpr,
          color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
          alphaBase: 0.25 + Math.random() * 0.55,
          phase: Math.random() * Math.PI * 2,
        };
      });
    }

    function draw(t: number) {
      if (stopped) return;
      ctx!.clearRect(0, 0, w, h);

      const cx = w / 2, cy = h / 2;
      const g = ctx!.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.42);
      g.addColorStop(0, "rgba(255,190,120,0.16)");
      g.addColorStop(0.3, "rgba(244,114,182,0.09)");
      g.addColorStop(0.6, "rgba(168,85,247,0.05)");
      g.addColorStop(1, "rgba(168,85,247,0)");
      ctx!.fillStyle = g;
      ctx!.fillRect(0, 0, w, h);

      for (const p of particles) {
        const twinkle = reduceMotion ? 1 : 0.6 + 0.4 * Math.sin(t * 0.0011 + p.phase);
        ctx!.globalAlpha = p.alphaBase * twinkle;
        ctx!.fillStyle = p.color;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
      if (!reduceMotion) raf = requestAnimationFrame(draw);
    }

    seed();
    draw(0);
    const ro = new ResizeObserver(seed);
    ro.observe(parent);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={`absolute inset-0 pointer-events-none ${className}`} />;
}
