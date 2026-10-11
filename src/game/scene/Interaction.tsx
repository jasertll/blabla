"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { layoutFor } from "../level";
import { runtime, useGame } from "../store";

/** Finds the interactable in reach and surfaces its prompt. */
export function Interaction() {
  useFrame(() => {
    const g = useGame.getState();
    const layout = layoutFor(g.floor);
    if (g.phase !== "play" || !layout || g.activeTool || g.overlay || runtime.path.length) {
      runtime.near = null;
      g.setPrompt(null);
      return;
    }
    let best = null;
    let bd = Infinity;
    for (const i of layout.interactables) {
      const d = Math.hypot(i.at[0] - runtime.pos.x, i.at[1] - runtime.pos.z);
      if (d < i.radius && d < bd) {
        bd = d;
        best = i;
      }
    }
    runtime.near = best;
    g.setPrompt(best ? best.label : null);
  });
  return null;
}

/** Fading ring where a click-to-walk landed. */
export function WalkMarker() {
  const ref = useRef<THREE.Mesh>(null!);
  const mat = useRef<THREE.MeshBasicMaterial>(null!);
  useFrame(() => {
    const age = (performance.now() - runtime.marker.t) / 1000;
    const on = age < 1.2 && runtime.path.length > 0;
    ref.current.visible = on;
    if (!on) return;
    ref.current.position.set(runtime.marker.x, 0.02, runtime.marker.z);
    ref.current.scale.setScalar(0.6 + age * 0.4);
    mat.current.opacity = 0.6 * (1 - age / 1.2);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[0.18, 0.24, 32]} />
      <meshBasicMaterial ref={mat} color="#d8d2c0" transparent depthWrite={false} />
    </mesh>
  );
}
