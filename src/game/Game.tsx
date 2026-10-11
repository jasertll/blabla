"use client";

import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect } from "react";
import * as THREE from "three";
import { closeOverlay, interact, toggleNightmare } from "./actions";
import { audio } from "./audio";
import { layoutFor } from "./level";
import { Atmosphere, Dust } from "./scene/Atmosphere";
import { Lobby, ScreenTicker, Shell, Ward } from "./scene/Building";
import { CameraRig } from "./scene/CameraRig";
import { Effects } from "./scene/Effects";
import { Interaction } from "./scene/Interaction";
import { IntroScene } from "./scene/IntroScene";
import { Monsters } from "./scene/Monsters";
import { Player } from "./scene/Player";
import { runtime, useGame } from "./store";
import { FadeLayer, Hud, OtherworldTint, Overlays, TearFlash, ToolOverlay } from "./ui/Hud";
import { IntroOverlay, TitleScreen } from "./ui/Title";

function finishIntro() {
  const g = useGame.getState();
  if (g.phase !== "intro") return;
  g.setFade(1);
  window.setTimeout(() => {
    const s = useGame.getState();
    runtime.pos.set(0, 0, 4.6);
    runtime.yaw = Math.PI;
    runtime.camYaw = Math.PI;
    runtime.camPitch = -0.12;
    s.setFloor("1F");
    s.setPhase("play");
    audio.creak();
  }, 800);
  window.setTimeout(() => {
    useGame.getState().setFade(0);
  }, 1500);
}

function World() {
  const phase = useGame((s) => s.phase);
  const floor = useGame((s) => s.floor);
  const layout = layoutFor(floor);
  return (
    <>
      <Atmosphere />
      <ScreenTicker />
      {phase === "intro" && <IntroScene onDone={finishIntro} />}
      {phase === "play" && layout && (
        <group key={floor}>
          <Shell layout={layout} />
          {floor === "1F" ? <Lobby /> : <Ward />}
          <Monsters floor={floor} />
        </group>
      )}
      {phase === "play" && (
        <>
          <Player />
          <CameraRig />
          <Interaction />
          <Dust />
        </>
      )}
      {phase !== "title" && <Effects />}
    </>
  );
}

// Handle for debugging and automated screenshots.
if (typeof window !== "undefined") (window as unknown as Record<string, unknown>).__brookhaven = { useGame, runtime };

export default function Game() {
  const phase = useGame((s) => s.phase);
  const quality = useGame((s) => s.quality);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const g = useGame.getState();
      if (g.phase !== "play") return;
      if (e.code === "Escape") {
        if (g.activeTool) g.closeTool();
        else if (g.overlay) closeOverlay();
        return;
      }
      if (e.code === "KeyM" && !g.activeTool) {
        if (g.overlay === "map") closeOverlay();
        else if (!g.overlay) g.setOverlay("map");
        return;
      }
      if (g.activeTool || g.overlay) return;
      runtime.keys.add(e.code);
      if (e.code === "KeyE" && runtime.near) interact(runtime.near);
      if (e.code === "KeyN") toggleNightmare();
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    };
    const up = (e: KeyboardEvent) => runtime.keys.delete(e.code);
    const blur = () => runtime.keys.clear();
    const move = (e: MouseEvent) => {
      if (!runtime.pointerLocked) return;
      runtime.camYaw -= e.movementX * 0.0024;
      runtime.camPitch = THREE.MathUtils.clamp(runtime.camPitch - e.movementY * 0.0018, -0.55, 0.35);
      runtime.lastMouse = performance.now();
    };
    const lockChange = () => {
      runtime.pointerLocked = !!document.pointerLockElement;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    window.addEventListener("mousemove", move);
    document.addEventListener("pointerlockchange", lockChange);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.removeEventListener("mousemove", move);
      document.removeEventListener("pointerlockchange", lockChange);
    };
  }, []);

  // Release the mouse whenever a panel takes over the screen.
  useEffect(
    () =>
      useGame.subscribe((s) => {
        if ((s.overlay || s.activeTool) && document.pointerLockElement) document.exitPointerLock();
        if (s.overlay || s.activeTool) runtime.keys.clear();
      }),
    [],
  );

  const onCanvasClick = useCallback((e: React.MouseEvent) => {
    const g = useGame.getState();
    if (g.phase !== "play" || g.overlay || g.activeTool) return;
    const el = e.currentTarget as HTMLElement;
    try {
      const p = el.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      /* pointer lock unavailable */
    }
  }, []);

  const dpr: [number, number] = quality === "high" ? [1, 1.75] : quality === "medium" ? [1, 1.25] : [0.6, 0.85];

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <div className="absolute inset-0" onClick={onCanvasClick}>
        <Canvas
          shadows={{ type: THREE.PCFShadowMap }}
          dpr={dpr}
          camera={{ fov: 52, near: 0.05, far: 90, position: [0, 1.6, 8] }}
          gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.05;
          }}
        >
          <World />
        </Canvas>
      </div>
      <OtherworldTint />
      {phase === "title" && <TitleScreen />}
      {phase === "intro" && <IntroOverlay onSkip={finishIntro} />}
      {phase === "play" && (
        <>
          <Hud />
          <ToolOverlay />
          <Overlays />
        </>
      )}
      <TearFlash />
      <FadeLayer />
    </div>
  );
}
