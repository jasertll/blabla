"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect } from "react";
import * as THREE from "three";
import { closeOverlay, interact, toggleNightmare } from "./actions";
import { audio } from "./audio";
import { layoutFor } from "./level";
import { Atmosphere, Dust } from "./scene/Atmosphere";
import { Lobby, ScreenTicker, Shell, Ward } from "./scene/Building";
import { CameraRig } from "./scene/CameraRig";
import { Effects } from "./scene/Effects";
import { Interaction, WalkMarker } from "./scene/Interaction";
import { IntroScene } from "./scene/IntroScene";
import { Monsters } from "./scene/Monsters";
import { Player } from "./scene/Player";
import { runtime, useGame } from "./store";
import { ENTRY_TAPE } from "./config/tapes.config";
import { FadeLayer, Hud, nextTape, OtherworldTint, Overlays, playTape, stopTape, TearFlash, ToolOverlay } from "./ui/Hud";
import { IntroOverlay, StormCinematic, TitleScreen } from "./ui/Title";

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
    if (!s.tapePlaying) playTape(ENTRY_TAPE);
  }, 800);
  window.setTimeout(() => {
    useGame.getState().setFade(0);
  }, 1500);
  window.setTimeout(() => {
    useGame.getState().say("I've never been inside this place. So why do I know where the elevator is?");
  }, 3200);
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
          <Suspense fallback={null}>
            <Monsters floor={floor} />
          </Suspense>
        </group>
      )}
      {phase === "play" && (
        <>
          <Player />
          <CameraRig />
          <Interaction />
          <WalkMarker />
          <Dust />
        </>
      )}
      {phase !== "title" && phase !== "storm" && <Effects />}
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
      if (e.code === "KeyT") nextTape();
      if (e.code === "KeyP") {
        if (g.tapePlaying) stopTape();
        else playTape(g.tapeId ?? ENTRY_TAPE);
      }
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    };
    const up = (e: KeyboardEvent) => runtime.keys.delete(e.code);
    const blur = () => runtime.keys.clear();
    // The camera follows the mouse: no click or capture needed.
    const move = (e: MouseEvent) => {
      runtime.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      runtime.mouseY = (e.clientY / window.innerHeight) * 2 - 1;
      const g = useGame.getState();
      if (g.phase !== "play" || g.overlay || g.activeTool) return;
      // the cursor jumping in from outside the window is not a look gesture
      if (Math.abs(e.movementX) > 150 || Math.abs(e.movementY) > 150) return;
      const k = runtime.pointerLocked ? 0.0024 : 0.0032;
      runtime.camYaw -= e.movementX * k;
      runtime.camPitch = THREE.MathUtils.clamp(runtime.camPitch - e.movementY * k * 0.7, -0.55, 0.35);
      runtime.lastMouse = performance.now();
    };
    const leave = () => {
      runtime.mouseX = 0;
      runtime.mouseY = 0;
    };
    const lockChange = () => {
      runtime.pointerLocked = !!document.pointerLockElement;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    window.addEventListener("mousemove", move);
    document.addEventListener("mouseleave", leave);
    document.addEventListener("pointerlockchange", lockChange);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.removeEventListener("mousemove", move);
      document.removeEventListener("mouseleave", leave);
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

  const dpr: [number, number] = quality === "high" ? [1, 1.75] : quality === "medium" ? [1, 1.25] : [0.6, 0.85];

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <div className="absolute inset-0">
        <Canvas
          shadows={{ type: THREE.PCFShadowMap }}
          dpr={dpr}
          camera={{ fov: 52, near: 0.05, far: 90, position: [0, 1.6, 8] }}
          gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
          onCreated={({ gl }) => {
            gl.domElement.addEventListener("webglcontextlost", (ev) => {
              ev.preventDefault();
              useGame.getState().say("The graphics card reset. Lowering quality…");
              useGame.getState().setQuality("low");
            });
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.05;
          }}
        >
          <World />
        </Canvas>
      </div>
      <OtherworldTint />
      {phase === "title" && <TitleScreen />}
      {phase === "storm" && <StormCinematic />}
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
