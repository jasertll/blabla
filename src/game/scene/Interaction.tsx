"use client";

import { useFrame } from "@react-three/fiber";
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
