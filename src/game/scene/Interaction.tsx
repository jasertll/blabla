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
      if (i.kind === "item" && g.flags.includes(`took:${i.id}`)) continue;
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

/** Health drinks lying where they were dropped: a small glowing bottle. */
export function Pickups() {
  const floor = useGame((s) => s.floor);
  const flags = useGame((s) => s.flags);
  const layout = layoutFor(floor);
  const items = layout?.interactables.filter((i) => i.kind === "item" && !flags.includes(`took:${i.id}`)) ?? [];
  return (
    <group>
      {items.map((i) => (
        <group key={i.id} position={[i.at[0], 0, i.at[1]]}>
          <mesh position={[0, 0.11, 0]} castShadow>
            <cylinderGeometry args={[0.035, 0.04, 0.2, 12]} />
            <meshStandardMaterial color="#2c5a3a" roughness={0.15} metalness={0.1} transparent opacity={0.85} emissive="#1d6b38" emissiveIntensity={0.6} />
          </mesh>
          <mesh position={[0, 0.235, 0]}>
            <cylinderGeometry args={[0.018, 0.018, 0.05, 8]} />
            <meshStandardMaterial color="#c9c3b0" roughness={0.6} />
          </mesh>
          <pointLight position={[0, 0.3, 0]} color="#3dff8a" intensity={0.35} distance={1.4} decay={2} />
        </group>
      ))}
    </group>
  );
}
