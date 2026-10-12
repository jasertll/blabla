"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { layoutFor, wallBoxes } from "../level";
import { runtime, useGame } from "../store";

const DIST = 2.6;
const tmp = new THREE.Vector3();
const head = new THREE.Vector3();
const desired = new THREE.Vector3();
const desiredLook = new THREE.Vector3();
const dir = new THREE.Vector3();

/** Over-the-shoulder in corridors, fixed cinematic angles in rooms, a slow
 *  push-in when examining something. */
export function CameraRig() {
  const camera = useThree((s) => s.camera);
  const look = useRef(new THREE.Vector3(0, 1.4, 0));
  const fill = useRef<THREE.PointLight>(null!);
  const floor = useGame((s) => s.floor);
  const walls = useMemo(() => {
    const l = layoutFor(floor);
    // outdoors the parapet is waist-high; only the tall structures block the camera
    return l ? (l.outdoor ? l.colliders.slice(0, 1) : wallBoxes(l)) : [];
  }, [floor]);
  const snap = useRef(true);
  const lastFloor = useRef(floor);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const g = useGame.getState();
    const layout = layoutFor(g.floor);
    if (g.phase !== "play" || !layout) {
      snap.current = true;
      return;
    }
    if (lastFloor.current !== g.floor) {
      lastFloor.current = g.floor;
      snap.current = true;
    }

    // Cursor held near the left/right edge keeps turning the camera.
    const g0 = useGame.getState();
    if (!runtime.focus && !g0.overlay && !g0.activeTool && Math.abs(runtime.mouseX) > 0.86) {
      runtime.camYaw -= Math.sign(runtime.mouseX) * (Math.abs(runtime.mouseX) - 0.86) * 12 * dt;
      runtime.lastMouse = performance.now();
    }

    // Let the camera drift behind the player when they walk without the mouse.
    const sinceMouse = performance.now() - runtime.lastMouse;
    if (!runtime.focus && runtime.speed > 0.5 && sinceMouse > 1500) {
      const d = Math.atan2(Math.sin(runtime.yaw - runtime.camYaw), Math.cos(runtime.yaw - runtime.camYaw));
      if (Math.abs(d) < 2.4) runtime.camYaw += d * (1 - Math.exp(-dt * 1.1));
    }

    head.set(runtime.pos.x, 1.55, runtime.pos.z);
    let k = 6;
    const zone = layout.camZones.find(
      (z) => runtime.pos.x > z.min[0] && runtime.pos.x < z.max[0] && runtime.pos.z > z.min[1] && runtime.pos.z < z.max[1],
    );

    if (runtime.focus) {
      desired.copy(runtime.focus.cam);
      desiredLook.copy(runtime.focus.look);
      k = 2.6;
      const settled = camera.position.distanceTo(desired) < 0.1 || performance.now() - g.toolOpenedAt > 1700;
      if (g.activeTool && !g.toolVisible && settled) g.showTool();
    } else if (zone) {
      desired.set(...zone.cam);
      desiredLook.set(runtime.pos.x, 1.15, runtime.pos.z);
      k = 2.2;
    } else {
      const fx = Math.sin(runtime.camYaw);
      const fz = Math.cos(runtime.camYaw);
      const rx = -fz;
      const rz = fx;
      const p = runtime.camPitch;
      desired.set(
        head.x - fx * DIST * Math.cos(p) + rx * 0.5,
        head.y + 0.2 - DIST * Math.sin(p),
        head.z - fz * DIST * Math.cos(p) + rz * 0.5,
      );
      desiredLook.set(head.x + fx * 4 + rx * 0.25, head.y + 4 * Math.sin(p) - 0.1, head.z + fz * 4 + rz * 0.25);

      // pull in if a wall is between head and camera
      const steps = 24;
      for (let i = 1; i <= steps; i++) {
        tmp.lerpVectors(head, desired, i / steps);
        const hit = walls.some((b) => tmp.x > b.min[0] - 0.18 && tmp.x < b.max[0] + 0.18 && tmp.z > b.min[1] - 0.18 && tmp.z < b.max[1] + 0.18);
        if (hit) {
          const f = Math.max(0.15, (i - 1.5) / steps);
          desired.lerpVectors(head, desired, f);
          // cramped: lift the camera so we look over the shoulder, not into the back
          desired.y += (1 - f) * 0.75;
          desiredLook.y -= (1 - f) * 0.5;
          break;
        }
      }
    }
    if (!layout.outdoor) desired.y = Math.min(desired.y, layout.height - 0.25);

    if (snap.current) {
      camera.position.copy(desired);
      look.current.copy(desiredLook);
      snap.current = false;
    } else {
      const a = 1 - Math.exp(-dt * k);
      camera.position.lerp(desired, a);
      look.current.lerp(desiredLook, 1 - Math.exp(-dt * (k + 2)));
    }

    if (runtime.shake > 0) {
      runtime.shake = Math.max(0, runtime.shake - dt * 0.5);
      const s = runtime.shake * 0.05;
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
    }
    camera.lookAt(look.current);
    camera.getWorldDirection(dir);
    runtime.viewYaw = Math.atan2(dir.x, dir.z);

    fill.current.position.copy(camera.position);
  });

  return <pointLight ref={fill} intensity={1.6} distance={7} decay={2} color="#9aa3a6" />;
}
