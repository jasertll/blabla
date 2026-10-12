"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { Ecctrl, type EcctrlHandle } from "ecctrl";
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


const FEET = 1.05; // capsule centre above the floor (half height + radius + float height)

/** Static walls, furniture and floor of the current level as physics colliders. */
export function LevelColliders() {
  const floor = useGame((s) => s.floor);
  const layout = layoutFor(floor);
  const boxes = useMemo(() => (layout ? [...wallBoxes(layout), ...layout.colliders] : []), [layout]);
  if (!layout) return null;
  return (
    <RigidBody key={floor} type="fixed" colliders={false}>
      {layout.rects.map((r, i) => (
        <CuboidCollider
          key={`f${i}`}
          args={[(r.max[0] - r.min[0]) / 2 + 0.3, 0.1, (r.max[1] - r.min[1]) / 2 + 0.3]}
          position={[(r.min[0] + r.max[0]) / 2, -0.1, (r.min[1] + r.max[1]) / 2]}
        />
      ))}
      {boxes.map((b, i) => (
        <CuboidCollider
          key={`w${i}`}
          args={[Math.max(0.02, (b.max[0] - b.min[0]) / 2), 1.4, Math.max(0.02, (b.max[1] - b.min[1]) / 2)]}
          position={[(b.min[0] + b.max[0]) / 2, 1.4, (b.min[1] + b.max[1]) / 2]}
        />
      ))}
    </RigidBody>
  );
}

/** The player: a physics capsule driven by ecctrl (pmndrs), carrying the hero. */
export function Player() {
  const ctrl = useRef<EcctrlHandle>(null);
  const pose = useRef<Pose>({ phase: 0, amount: 0 });
  const quality = useGame((s) => s.quality);
  const lastStep = useRef(0);
  const camera = useThree((s) => s.camera);
  const fwd = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const c = ctrl.current;
    const g = useGame.getState();
    const layout = layoutFor(g.floor);
    if (!c || g.phase !== "play" || !layout) return;
    const body = c.body;

    // someone moved us (elevator, save, intro): put the body there
    const p = c.currPos;
    if (Math.hypot(p.x - runtime.pos.x, p.z - runtime.pos.z) > 1.5 || p.y < -4) {
      body.setTranslation({ x: runtime.pos.x, y: FEET + 0.05, z: runtime.pos.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), runtime.yaw);
      body.setRotation(q, true);
      return;
    }

    const blocked = !!g.activeTool || !!g.overlay || isRiding() || g.fade > 0.5;
    const k = runtime.keys;
    const input = {
      forward: !blocked && (k.has("KeyW") || k.has("ArrowUp")),
      backward: !blocked && (k.has("KeyS") || k.has("ArrowDown")),
      leftward: !blocked && (k.has("KeyA") || k.has("ArrowLeft")),
      rightward: !blocked && (k.has("KeyD") || k.has("ArrowRight")),
      run: !blocked && (k.has("ShiftLeft") || k.has("ShiftRight")),
      joystick: { x: 0, y: 0 },
    };
    const manual = input.forward || input.backward || input.leftward || input.rightward;
    if (manual) runtime.path = [];
    else if (!blocked && runtime.path.length) {
      // auto-travel: steer with the virtual stick, relative to the camera
      const step = runtime.path[0];
      if (step.floor === g.floor) {
        const ex = step.x - p.x;
        const ez = step.z - p.z;
        const d = Math.hypot(ex, ez);
        if (d < 0.35) {
          runtime.path.shift();
          if (step.ride) rideElevator(step.ride);
        } else {
          camera.getWorldDirection(fwd);
          fwd.y = 0;
          fwd.normalize();
          const dx = ex / d;
          const dz = ez / d;
          const s = d < 0.9 ? 0.55 : 1;
          input.joystick = { y: (dx * fwd.x + dz * fwd.z) * s, x: (dx * -fwd.z + dz * fwd.x) * s };
        }
      }
    }
    c.setMovement(input);

    runtime.pos.set(p.x, 0, p.z);
    const z = c.bodyZAxis;
    runtime.yaw = Math.atan2(z.x, z.z);
    const speed = c.moveSpeed;
    runtime.speed = speed;

    // gait + footsteps
    runtime.walkPhase += dt * speed * (speed > 3 ? 2.5 : 3.1);
    pose.current.phase = runtime.walkPhase;
    pose.current.amount = Math.min(speed / WALK, 2.3);
    const stepIdx = Math.floor(runtime.walkPhase / Math.PI);
    if (stepIdx !== lastStep.current && speed > 0.4) {
      lastStep.current = stepIdx;
      audio.footstep(isOtherworld() ? "grate" : g.floor === "ROOF" ? "asphalt" : "tile", speed > 3);
    }

    for (const r of layout.rooms)
      if (p.x > r.min[0] && p.x < r.max[0] && p.z > r.min[1] && p.z < r.max[1]) g.visit(r.id);
  });

  return (
    <Ecctrl
      ref={ctrl}
      position={[runtime.pos.x, FEET + 0.05, runtime.pos.z]}
      rotation={[0, runtime.yaw, 0]}
      capsuleHalfHeight={0.5}
      capsuleRadius={0.3}
      floatHeight={0.25}
      maxWalkVel={WALK}
      maxRunVel={RUN}
      enableToggleRun={false}
      jumpVel={0}
      accDeltaTime={0.12}
      autoBalanceSpringOnY={0.25}
      autoBalanceDampingOnY={0.02}
    >
      <group position={[0, -FEET, 0]}>
        {/* a soft key light on the hero, as games do, so he never becomes a pure silhouette */}
        <pointLight position={[0.6, 2.3, 1.4]} intensity={1.1} distance={3.2} decay={2} color="#c9d0cc" />
        <Character pose={pose} shadowSize={quality === "high" ? 2048 : quality === "medium" ? 1024 : 512} />
      </group>
    </Ecctrl>
  );
}
