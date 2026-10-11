"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { layoutFor, wallBoxes, type Box, type V2 } from "../level";
import { runtime, useGame, type PlayFloor } from "../store";
import { baseTexture } from "../textures";
import { collide } from "./Player";

/** Distance from the player to every visible creature; the radio listens to it. */
export const threatDistances = new Map<string, number>();

const flesh = () =>
  new THREE.MeshStandardMaterial({ color: "#2a1916", roughness: 0.5, metalness: 0, transparent: true });

const tmp = new THREE.Vector3();

function isLit(x: number, z: number, maxDist = 10, cone = 0.45) {
  const vx = x - runtime.pos.x;
  const vz = z - runtime.pos.z;
  const d = Math.hypot(vx, vz);
  if (d > maxDist || d < 0.01) return false;
  const dot = (Math.sin(runtime.yaw) * vx + Math.cos(runtime.yaw) * vz) / d;
  return Math.acos(Math.min(1, dot)) < cone;
}

function randomIn(area: { min: V2; max: V2 }) {
  return new THREE.Vector3(
    area.min[0] + Math.random() * (area.max[0] - area.min[0]),
    0,
    area.min[1] + Math.random() * (area.max[1] - area.min[1]),
  );
}

// ------------------------------------------------------------------ lying figure

/** Faceless figure bound in its own skin. Wanders, writhes, and shrinks from light. */
function LyingFigure({ id, area, boxes, start }: { id: string; area: { min: V2; max: V2 }; boxes: Box[]; start: V2 }) {
  const root = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Group>(null!);
  const legL = useRef<THREE.Group>(null!);
  const legR = useRef<THREE.Group>(null!);
  const mat = useMemo(flesh, []);
  const torso = useMemo(() => {
    const pts = [
      [0.0, 0.0],
      [0.13, 0.06],
      [0.19, 0.25],
      [0.21, 0.5],
      [0.2, 0.72],
      [0.15, 0.88],
      [0.1, 0.98],
      [0.11, 1.05],
      [0.07, 1.12],
      [0.0, 1.15],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(pts, 18);
    // lumpy, uneven surface
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const k = 1 + Math.sin(y * 23 + a * 3) * 0.06 + Math.sin(y * 9 - a * 5) * 0.05;
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k * 0.82);
    }
    g.computeVertexNormals();
    return g;
  }, []);

  const s = useRef({
    pos: new THREE.Vector3(start[0], 0, start[1]),
    target: randomIn(area),
    mode: "wander" as "wander" | "approach" | "flee" | "hidden",
    timer: 0,
    opacity: 1,
    heading: 0,
    twitch: 0,
    gait: 0,
  });

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const st = s.current;
    const t = clock.elapsedTime;
    const nightmare = useGame.getState().nightmare || runtime.dread > 0.5;
    const lit = st.mode !== "hidden" && isLit(st.pos.x, st.pos.z);
    const toPlayer = tmp.set(runtime.pos.x - st.pos.x, 0, runtime.pos.z - st.pos.z);
    const d = toPlayer.length();
    let speed = 0;
    let dir = 0;

    if (lit && d < 8 && st.mode !== "flee") {
      st.mode = "flee";
      st.timer = 2.4;
    }
    switch (st.mode) {
      case "wander": {
        const dx = st.target.x - st.pos.x;
        const dz = st.target.z - st.pos.z;
        if (Math.hypot(dx, dz) < 0.4) st.target = randomIn(area);
        dir = Math.atan2(dx, dz);
        speed = 0.6;
        if (nightmare && d < 14) st.mode = "approach";
        break;
      }
      case "approach":
        dir = Math.atan2(toPlayer.x, toPlayer.z);
        speed = d > 2.4 ? 1.05 : 0;
        if (!nightmare) st.mode = "wander";
        break;
      case "flee":
        dir = Math.atan2(-toPlayer.x, -toPlayer.z);
        speed = 2.3;
        st.timer -= dt;
        st.opacity = Math.max(0, st.timer / 2.4);
        if (st.timer <= 0) {
          st.mode = "hidden";
          st.timer = 6 + Math.random() * 8;
        }
        break;
      case "hidden":
        st.timer -= dt;
        if (st.timer <= 0) {
          // reappear somewhere out of sight
          for (let i = 0; i < 12; i++) {
            const p = randomIn(area);
            if (p.distanceTo(runtime.pos) > 9) {
              st.pos.copy(p);
              break;
            }
          }
          st.mode = "wander";
          st.target = randomIn(area);
        }
        break;
    }
    if (st.mode !== "flee") st.opacity = Math.min(1, st.opacity + dt * (st.mode === "hidden" ? -2 : 0.5));
    if (st.mode === "hidden") st.opacity = 0;

    if (speed > 0) {
      const turn = Math.atan2(Math.sin(dir - st.heading), Math.cos(dir - st.heading));
      st.heading += turn * (1 - Math.exp(-dt * 5));
      // shuffle: lurches forward in uneven pulses
      const lurch = 0.55 + Math.max(0, Math.sin(t * 4.2 + st.pos.x)) * 0.9;
      st.pos.x += Math.sin(st.heading) * speed * lurch * dt;
      st.pos.z += Math.cos(st.heading) * speed * lurch * dt;
      collide(st.pos, boxes, 0.3);
      st.pos.x = THREE.MathUtils.clamp(st.pos.x, area.min[0], area.max[0]);
      st.pos.z = THREE.MathUtils.clamp(st.pos.z, area.min[1], area.max[1]);
      st.gait += dt * speed * 5;
    }

    // writhing: constant unease, violent spasms when lit
    st.twitch = Math.max(0, st.twitch - dt);
    if (Math.random() < (lit ? 0.2 : 0.012)) st.twitch = 0.15 + Math.random() * 0.25;
    const sp = st.twitch > 0 ? 1 : 0;
    body.current.rotation.z = Math.sin(t * 2.3) * 0.08 + sp * (Math.random() - 0.5) * 0.5;
    body.current.rotation.x = 0.12 + Math.sin(t * 1.7) * 0.05 + sp * (Math.random() - 0.5) * 0.4;
    body.current.rotation.y = sp * (Math.random() - 0.5) * 0.6;
    body.current.scale.set(1 + Math.sin(t * 3.1) * 0.03, 1 + Math.sin(t * 2.2) * 0.02, 1);
    legL.current.rotation.x = Math.sin(st.gait) * 0.35;
    legR.current.rotation.x = -Math.sin(st.gait) * 0.35;

    root.current.position.copy(st.pos);
    root.current.rotation.y = st.heading;
    root.current.visible = st.opacity > 0.01;
    mat.opacity = st.opacity;
    mat.color.setRGB(0.028 + runtime.dread * 0.02, 0.012, 0.01);
    threatDistances.set(id, root.current.visible ? d : 99);
  });

  return (
    <group ref={root}>
      <group ref={legL} position={[0.08, 0.82, 0]} rotation={[0, 0, 0.05]}>
        <mesh position={[0, -0.41, 0.04]} rotation={[0.1, 0, 0]} material={mat} castShadow>
          <capsuleGeometry args={[0.05, 0.72, 4, 8]} />
        </mesh>
      </group>
      <group ref={legR} position={[-0.08, 0.82, 0]} rotation={[0, 0, -0.05]}>
        <mesh position={[0, -0.41, 0.04]} rotation={[0.1, 0, 0]} material={mat} castShadow>
          <capsuleGeometry args={[0.05, 0.72, 4, 8]} />
        </mesh>
      </group>
      <group ref={body} position={[0, 0.78, 0]}>
        <mesh geometry={torso} material={mat} castShadow />
      </group>
    </group>
  );
}

// ------------------------------------------------------------------ the watcher

/** A tall executioner-like silhouette under a huge metal helmet. Never attacks;
 *  only watches from the end of the hall and is gone when you get close. */
function Watcher({ id, at, yaw }: { id: string; at: V2; yaw: number }) {
  const root = useRef<THREE.Group>(null!);
  const metal = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#4a3a2c", roughness: 0.55, metalness: 0.7, transparent: true }),
    [],
  );
  const cloth = useMemo(() => new THREE.MeshStandardMaterial({ color: "#3d3427", roughness: 1, transparent: true, side: THREE.DoubleSide }), []);
  const skin = useMemo(() => new THREE.MeshStandardMaterial({ color: "#5a4a40", roughness: 0.6, transparent: true }), []);
  const st = useRef({ opacity: 0, watched: 0, gone: 0 });

  useFrame(({ clock }, dt) => {
    const s = st.current;
    const d = Math.hypot(at[0] - runtime.pos.x, at[1] - runtime.pos.z);
    if (isLit(at[0], at[1], 16, 0.35)) s.watched += dt;
    if (s.gone > 0) s.gone -= dt;
    else if (d < 7 || s.watched > 1.3) {
      s.gone = 25;
      s.watched = 0;
    }
    const want = s.gone > 0 ? 0 : 1;
    s.opacity += (want - s.opacity) * (1 - Math.exp(-dt * (want ? 0.4 : 1.6)));
    [metal, cloth, skin].forEach((m) => (m.opacity = s.opacity));
    root.current.visible = s.opacity > 0.02;
    root.current.rotation.y = yaw + Math.sin(clock.elapsedTime * 0.4) * 0.05;
    threatDistances.set(id, root.current.visible ? d : 99);
  });

  return (
    <group ref={root} position={[at[0], 0, at[1]]} rotation={[0, yaw, 0]}>
      {/* legs + butcher's skirt */}
      {[-0.17, 0.17].map((x) => (
        <mesh key={x} position={[x, 0.55, 0]} material={skin} castShadow>
          <capsuleGeometry args={[0.1, 0.9, 4, 8]} />
        </mesh>
      ))}
      <mesh position={[0, 0.8, 0]} material={cloth} castShadow>
        <cylinderGeometry args={[0.36, 0.55, 1.1, 14, 1, true]} />
      </mesh>
      {/* bare torso + arms */}
      <mesh position={[0, 1.65, 0]} scale={[1.3, 1, 0.8]} material={skin} castShadow>
        <capsuleGeometry args={[0.26, 0.5, 6, 12]} />
      </mesh>
      {[-0.48, 0.48].map((x) => (
        <mesh key={x} position={[x, 1.45, 0.05]} rotation={[0.1, 0, x > 0 ? 0.12 : -0.12]} material={skin} castShadow>
          <capsuleGeometry args={[0.09, 0.95, 4, 8]} />
        </mesh>
      ))}
      {/* the helmet: a massive iron wedge */}
      <mesh position={[0, 2.45, 0.25]} rotation={[0.35, Math.PI / 4, 0]} scale={[1, 1, 1]} material={metal} castShadow>
        <coneGeometry args={[0.72, 1.25, 4, 1]} />
      </mesh>
      {/* the great knife, dragged */}
      <mesh position={[0.62, 0.9, 0.4]} rotation={[0.9, 0, 0.15]} material={metal} castShadow>
        <boxGeometry args={[0.06, 2.3, 0.42]} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------ fog shadows

/** Human-shaped shadows that coalesce in the fog and dissolve before you reach them. */
export function FogShadows({ count, areas, minDist = 6, maxDist = 15 }: { count: number; areas: { min: V2; max: V2 }[]; minDist?: number; maxDist?: number }) {
  const sprites = useMemo(
    () =>
      Array.from({ length: count }, () => {
        const m = new THREE.SpriteMaterial({ map: baseTexture("silhouette"), transparent: true, opacity: 0, depthWrite: false, color: "#000" });
        const sp = new THREE.Sprite(m);
        sp.scale.set(0.95, 1.9, 1);
        return { sp, state: "wait" as "in" | "hold" | "out" | "wait", t: Math.random() * 4 };
      }),
    [count],
  );

  useFrame((_, dt) => {
    for (const s of sprites) {
      const m = s.sp.material;
      s.t -= dt;
      const d = s.sp.position.distanceTo(tmp.set(runtime.pos.x, 0.95, runtime.pos.z));
      if (s.state !== "wait" && d < 4) s.state = "out";
      switch (s.state) {
        case "wait":
          m.opacity = 0;
          if (s.t <= 0) {
            for (let i = 0; i < 10; i++) {
              const a = areas[Math.floor(Math.random() * areas.length)];
              const p = randomIn(a);
              const dd = p.distanceTo(tmp.set(runtime.pos.x, 0, runtime.pos.z));
              if (dd > minDist && dd < maxDist) {
                s.sp.position.set(p.x, 0.95, p.z);
                s.state = "in";
                break;
              }
            }
            s.t = 1.2;
          }
          break;
        case "in":
          m.opacity = Math.min(0.75, m.opacity + dt * 0.6);
          if (m.opacity >= 0.75) {
            s.state = "hold";
            s.t = 1 + Math.random() * 2;
          }
          break;
        case "hold":
          s.sp.position.x += Math.sin(performance.now() / 900) * dt * 0.1;
          if (s.t <= 0) s.state = "out";
          break;
        case "out":
          m.opacity = Math.max(0, m.opacity - dt * 0.9);
          if (m.opacity <= 0) {
            s.state = "wait";
            s.t = 2 + Math.random() * 6;
          }
          break;
      }
    }
  });

  return (
    <group>
      {sprites.map((s, i) => (
        <primitive key={i} object={s.sp} />
      ))}
    </group>
  );
}

// ------------------------------------------------------------------ per-floor cast

export function Monsters({ floor }: { floor: PlayFloor }) {
  const nightmare = useGame((s) => s.nightmare);
  const otherworld = useGame((s) => s.owActive);
  const layout = layoutFor(floor);
  const boxes = useMemo(() => (layout ? [...wallBoxes(layout), ...layout.colliders] : []), [layout]);
  useEffect(() => {
    threatDistances.clear();
  }, [floor, nightmare, otherworld]);
  if (!layout) return null;
  const intense = nightmare || otherworld;

  if (floor === "1F") {
    const area = { min: [3, -7] as V2, max: [9, 7] as V2 };
    return (
      <group>
        <FogShadows count={intense ? 5 : 2} areas={layout.rects.slice(0, 1)} />
        {intense && <LyingFigure id="1f-a" area={area} boxes={boxes} start={[8, 6]} />}
        {nightmare && <Watcher id="1f-w" at={[-7.6, -6.6]} yaw={0.6} />}
      </group>
    );
  }
  const corridor = { min: [-1.2, -23] as V2, max: [1.2, -7] as V2 };
  return (
    <group>
      <FogShadows count={intense ? 5 : 2} areas={[{ min: [-1.4, -23], max: [1.4, -6] }]} minDist={7} maxDist={18} />
      <LyingFigure id="2f-a" area={corridor} boxes={boxes} start={[0, -18]} />
      {intense && <LyingFigure id="2f-b" area={{ min: [-1.2, -14], max: [1.2, 2.5] }} boxes={boxes} start={[0.5, -13]} />}
      {nightmare && <Watcher id="2f-w" at={[0, -22.9]} yaw={0} />}
    </group>
  );
}
