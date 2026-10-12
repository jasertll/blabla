"use client";

import { useFrame } from "@react-three/fiber";
import { Bloom, BrightnessContrast, ChromaticAberration, EffectComposer, HueSaturation, N8AO, Noise, Vignette } from "@react-three/postprocessing";
import { BlendFunction, type ChromaticAberrationEffect, type NoiseEffect, type VignetteEffect } from "postprocessing";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { runtime, useGame } from "../store";

/** Film grain, vignette and lens fringing — heavier as the world rots. */
export function Effects() {
  const quality = useGame((s) => s.quality);
  const noise = useRef<NoiseEffect>(null!);
  const vignette = useRef<VignetteEffect>(null!);
  const ca = useRef<ChromaticAberrationEffect>(null!);
  const offset = useMemo(() => new THREE.Vector2(0.0008, 0.0006), []);

  useFrame(({ clock }) => {
    const d = runtime.dread;
    if (noise.current) noise.current.blendMode.opacity.value = 0.2 + d * 0.22;
    if (vignette.current) vignette.current.darkness = 0.72 + d * 0.22;
    if (ca.current) {
      const pulse = d * (0.0025 + Math.sin(clock.elapsedTime * 1.3) * 0.001);
      const s = 0.0008 + pulse + runtime.shake * 0.003;
      ca.current.offset.set(s, s * 0.7);
    }
  });

  if (quality === "low")
    return (
      <EffectComposer multisampling={0}>
        <HueSaturation hue={0.04} saturation={-0.3} />
        <Noise ref={noise} premultiply blendFunction={BlendFunction.SCREEN} />
        <Vignette ref={vignette} eskil={false} offset={0.22} darkness={0.75} />
      </EffectComposer>
    );

  return (
    <EffectComposer multisampling={quality === "high" ? 4 : 0}>
      <N8AO aoRadius={0.9} distanceFalloff={0.6} intensity={2.6} quality={quality === "high" ? "high" : "medium"} halfRes={quality !== "high"} />
      <Bloom intensity={0.55} luminanceThreshold={0.62} luminanceSmoothing={0.3} mipmapBlur />
      {/* the look: colour drained toward grey-green, blacks crushed a little */}
      <HueSaturation hue={0.04} saturation={-0.3} />
      <BrightnessContrast brightness={-0.015} contrast={0.12} />
      <ChromaticAberration ref={ca} offset={offset} radialModulation modulationOffset={0.25} />
      <Noise ref={noise} premultiply blendFunction={BlendFunction.SCREEN} />
      <Vignette ref={vignette} eskil={false} offset={0.22} darkness={0.75} />
    </EffectComposer>
  );
}
