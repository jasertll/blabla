import * as THREE from "three";
import { audio } from "./audio";
import { runtime, useGame } from "./store";

// Fighting back. Every creature that can be hurt registers itself here; the
// player's swing finds whatever is in front of the pipe.

export interface Foe {
  pos: THREE.Vector3;
  alive: boolean;
  hit: (damage: number, from: THREE.Vector3) => void;
}

export const foes = new Map<string, Foe>();

const REACH = 2.4;
const ARC = 1.05; // radians either side of facing

/** Swing the pipe. The blow lands a moment into the swing. */
export function attack() {
  const g = useGame.getState();
  if (g.dead || g.activeTool || g.overlay) return;
  const before = g.swingAt;
  g.swing();
  if (useGame.getState().swingAt === before) return; // still recovering
  audio.whoosh();
  window.setTimeout(() => {
    const from = runtime.pos.clone();
    let landed = false;
    for (const f of foes.values()) {
      if (!f.alive) continue;
      const vx = f.pos.x - from.x;
      const vz = f.pos.z - from.z;
      const d = Math.hypot(vx, vz);
      if (d > REACH) continue;
      const ang = Math.atan2(vx, vz);
      const diff = Math.abs(Math.atan2(Math.sin(ang - runtime.yaw), Math.cos(ang - runtime.yaw)));
      if (diff > ARC && d > 0.7) continue;
      f.hit(34, from);
      landed = true;
    }
    if (landed) {
      audio.impact();
      runtime.shake = Math.max(runtime.shake, 0.35);
    }
  }, 230);
}

/** A creature reaches you. */
export function hurtPlayer(n: number) {
  const g = useGame.getState();
  if (g.dead) return;
  g.hurt(n);
  audio.impact();
  runtime.shake = Math.max(runtime.shake, 0.8);
  if (useGame.getState().dead) {
    runtime.path = [];
    audio.stinger();
  }
}
