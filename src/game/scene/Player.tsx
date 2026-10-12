"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { isRiding, rideElevator } from "../actions";
import { audio } from "../audio";
import { layoutFor, wallBoxes, type Box } from "../level";
import { isOtherworld, runtime, useGame } from "../store";
import { Character, type Pose } from "./Character";

const RADIUS = 0.33;
const WALK = 1.9;
const RUN = 4.2;
const AUTO = 2.6;

export function collide(p: THREE.Vector3, boxes: Box[], radius = RADIUS) {
  for (let iter = 0; iter < 2; iter++) {
    for (const b of boxes) {
      const minX = b.min[0] - radius;
      const maxX = b.max[0] + radius;
      const minZ = b.min[1] - radius;
      const maxZ = b.max[1] + radius;
      if (p.x > minX && p.x < maxX && p.z > minZ && p.z < maxZ) {
        const dx1 = p.x - minX;
        const dx2 = maxX - p.x;
        const dz1 = p.z - minZ;
        const dz2 = maxZ - p.z;
        const m = Math.min(dx1, dx2, dz1, dz2);
        if (m === dx1) p.x = minX;
        else if (m === dx2) p.x = maxX;
        else if (m === dz1) p.z = minZ;
        else p.z = maxZ;
      }
    }
  }
}

const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function Player() {
  const group = useRef<THREE.Group>(null!);
  const pose = useRef<Pose>({ phase: 0, amount: 0 });
  const floor = useGame((s) => s.floor);
  const quality = useGame((s) => s.quality);
  const boxes = useMemo(() => {
    const l = layoutFor(floor);
    return l ? [...wallBoxes(l), ...l.colliders] : [];
  }, [floor]);
  const vel = useRef(new THREE.Vector2());
  const lastStep = useRef(0);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const g = useGame.getState();
    const layout = layoutFor(g.floor);
    if (g.phase !== "play" || !layout) return;
    const blocked = !!g.activeTool || !!g.overlay || isRiding() || g.fade > 0.5;

    const k = runtime.keys;
    const fwd = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const strafe = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const running = k.has("ShiftLeft") || k.has("ShiftRight");

    let dx = 0;
    let dz = 0;
    let target = 0;
    if (!blocked && (fwd || strafe)) {
      runtime.path = [];
      const vy = runtime.viewYaw;
      dx = Math.sin(vy) * fwd - Math.cos(vy) * strafe;
      dz = Math.cos(vy) * fwd + Math.sin(vy) * strafe;
      target = running ? RUN : WALK;
    } else if (!blocked && runtime.path.length) {
      const step = runtime.path[0];
      if (step.floor === g.floor) {
        const ex = step.x - runtime.pos.x;
        const ez = step.z - runtime.pos.z;
        const d = Math.hypot(ex, ez);
        if (d < 0.3) {
          runtime.path.shift();
          if (step.ride) rideElevator(step.ride);
        } else {
          dx = ex;
          dz = ez;
          target = d < 0.8 ? AUTO * 0.6 : AUTO;
        }
      }
    }
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      dx /= len;
      dz /= len;
      const want = Math.atan2(dx, dz);
      runtime.yaw += angleDiff(runtime.yaw, want) * (1 - Math.exp(-dt * 10));
    }

    // ease velocity for weight
    const accel = 1 - Math.exp(-dt * (target ? 7 : 10));
    vel.current.x += (dx * target - vel.current.x) * accel;
    vel.current.y += (dz * target - vel.current.y) * accel;
    runtime.pos.x += vel.current.x * dt;
    runtime.pos.z += vel.current.y * dt;
    collide(runtime.pos, boxes);
    const speed = vel.current.length();
    runtime.speed = speed;

    // gait + footsteps
    runtime.walkPhase += dt * speed * (speed > 3 ? 2.5 : 3.1);
    pose.current.phase = runtime.walkPhase;
    pose.current.amount = Math.min(speed / WALK, 2.3);
    const stepIdx = Math.floor(runtime.walkPhase / Math.PI);
    if (stepIdx !== lastStep.current && speed > 0.4) {
      lastStep.current = stepIdx;
      audio.footstep(isOtherworld() ? "grate" : useGame.getState().floor === "ROOF" ? "asphalt" : "tile", speed > 3);
    }

    // room tracking for the map
    for (const r of layout.rooms)
      if (runtime.pos.x > r.min[0] && runtime.pos.x < r.max[0] && runtime.pos.z > r.min[1] && runtime.pos.z < r.max[1]) g.visit(r.id);

    group.current.position.copy(runtime.pos);
    group.current.rotation.y = runtime.yaw;
  });

  return (
    <group ref={group}>
      <Character pose={pose} shadowSize={quality === "high" ? 2048 : quality === "medium" ? 1024 : 512} />
    </group>
  );
}
