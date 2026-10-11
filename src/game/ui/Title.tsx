"use client";

import { useEffect, useRef, useState } from "react";
import { audio } from "../audio";
import { ENTRY_TAPE } from "../config/tapes.config";
import { hasSave, runtime, useGame } from "../store";
import { playTape } from "./Hud";

/** Drifting fog drawn on a canvas: layered soft blobs scrolling at different speeds. */
export function FogCanvas({ className = "", tint = "rgba(170,172,168," }: { className?: string; tint?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    const blobs = Array.from({ length: 46 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.15 + Math.random() * 0.35,
      v: 0.004 + Math.random() * 0.012,
      a: 0.05 + Math.random() * 0.08,
    }));
    const resize = () => {
      c.width = c.clientWidth / 2;
      c.height = c.clientHeight / 2;
    };
    resize();
    window.addEventListener("resize", resize);
    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = c.width;
      const h = c.height;
      ctx.clearRect(0, 0, w, h);
      for (const b of blobs) {
        b.x += b.v * dt * 6;
        if (b.x - b.r > 1.1) b.x = -b.r;
        const R = b.r * Math.max(w, h);
        const g = ctx.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, R);
        g.addColorStop(0, `${tint}${b.a})`);
        g.addColorStop(1, `${tint}0)`);
        ctx.fillStyle = g;
        ctx.fillRect(b.x * w - R, b.y * h - R, R * 2, R * 2);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [tint]);
  return <canvas ref={ref} className={`absolute inset-0 h-full w-full ${className}`} />;
}

export function TitleScreen() {
  const [ready, setReady] = useState(false);
  const [canContinue, setCanContinue] = useState(false);
  const setPhase = useGame((s) => s.setPhase);

  useEffect(() => {
    setCanContinue(hasSave());
    const t = window.setTimeout(() => setReady(true), 3800);
    return () => window.clearTimeout(t);
  }, []);

  const newGame = () => {
    audio.start();
    audio.blip();
    useGame.getState().setFloor("EXTERIOR");
    setPhase("storm");
  };

  const cont = () => {
    audio.start();
    audio.blip();
    const g = useGame.getState();
    if (!g.load()) return newGame();
    g.setFade(1);
    g.setPhase("play");
    if (!g.tapePlaying) playTape(ENTRY_TAPE);
    runtime.camYaw = runtime.yaw;
    window.setTimeout(() => useGame.getState().setFade(0), 400);
  };

  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Enter" || e.code === "Space") newGame();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return (
    <div className="title-screen absolute inset-0 z-40 overflow-hidden bg-[#7d7f7b]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,#9c9e9a_0%,#6e706c_60%,#3b3d3a_100%)]" />
      <FogCanvas />
      <FogCanvas className="opacity-60 [transform:scaleX(-1)]" tint="rgba(205,207,203," />
      <div className="grain absolute inset-0" />
      <div className="relative z-10 flex h-full flex-col items-center justify-center px-4 text-center">
        <h1 className="title-text font-display text-[clamp(2.2rem,7vw,6rem)] font-light uppercase text-[#e9e7df]">Brookhaven Hospital</h1>
        <p className="title-sub mt-4 font-display text-[clamp(0.9rem,1.8vw,1.25rem)] italic tracking-[0.3em] text-[#e9e7df]/70">
          the fog never lifted
        </p>
        <div className={`mt-16 flex flex-col items-center gap-4 transition-opacity duration-[2000ms] ${ready ? "opacity-100" : "pointer-events-none opacity-0"}`}>
          <button onClick={newGame} className="menu-item font-display text-xl tracking-[0.35em] text-[#f2f0e8]">
            NEW GAME
          </button>
          {canContinue && (
            <button onClick={cont} className="menu-item font-display text-xl tracking-[0.35em] text-[#f2f0e8]">
              CONTINUE
            </button>
          )}
          <p className="mt-6 animate-pulse font-display text-sm tracking-[0.4em] text-[#f2f0e8]/60">PRESS ENTER</p>
          <p className="mt-2 font-mono text-[11px] tracking-widest text-[#f2f0e8]/45">best with headphones</p>
        </div>
      </div>
    </div>
  );
}

const LINES = [
  { at: 0.8, to: 5.2, text: "The letter said the network inside was still running." },
  { at: 5.6, to: 9.6, text: "Nobody has worked here for years." },
  { at: 10, to: 13.4, text: "Somebody is still logging in." },
];

export function IntroOverlay({ onSkip }: { onSkip: () => void }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const id = window.setInterval(() => setT((performance.now() - start) / 1000), 100);
    return () => window.clearInterval(id);
  }, []);
  const line = LINES.find((l) => t >= l.at && t <= l.to);
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div className="letterbox-top absolute inset-x-0 top-0 h-[11vh] bg-black" />
      <div className="letterbox-bottom absolute inset-x-0 bottom-0 flex h-[11vh] items-center justify-center bg-black px-4">
        <p key={line?.text} className={`subtitle font-display text-[clamp(0.95rem,2vw,1.35rem)] italic text-[#e8e4d8] ${line ? "opacity-100" : "opacity-0"}`}>
          {line?.text ?? ""}
        </p>
      </div>
      <button onClick={onSkip} className="pointer-events-auto absolute right-4 top-[calc(11vh+12px)] font-display text-sm tracking-[0.3em] text-white/60 hover:text-white">
        SKIP ▸
      </button>
    </div>
  );
}

/** Opening cinematic: the storm, before the walk through the fog. */
export function StormCinematic() {
  const setPhase = useGame((s) => s.setPhase);
  const [ended, setEnded] = useState(false);
  const next = () => {
    if (ended) return;
    setEnded(true);
    window.setTimeout(() => setPhase("intro"), 900);
  };
  return (
    <div className={`absolute inset-0 z-40 bg-black transition-opacity duration-[900ms] ${ended ? "opacity-0" : "opacity-100"}`}>
      <video
        className="storm-video absolute inset-0 h-full w-full object-cover"
        autoPlay
        playsInline
        onEnded={next}
      >
        <source src="video/storm.webm" type="video/webm" />
        <source src="video/storm.mp4" type="video/mp4" onError={next} />
      </video>
      <div className="grain absolute inset-0" />
      <div className="absolute inset-x-0 top-0 h-[11vh] bg-black" />
      <div className="absolute inset-x-0 bottom-0 flex h-[11vh] items-center justify-center bg-black px-4">
        <p className="subtitle storm-line font-display text-[clamp(0.95rem,2vw,1.35rem)] italic text-[#e8e4d8]">Then the storm came, and the town went quiet.</p>
      </div>
      <button onClick={next} className="absolute right-4 top-[calc(11vh+12px)] font-display text-sm tracking-[0.3em] text-white/60 hover:text-white">
        SKIP ▸
      </button>
    </div>
  );
}
