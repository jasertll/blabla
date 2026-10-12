"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { layoutFor, wallBoxes, type Box, type V2 } from "../level";
import { B1_BARS_Z } from "../floors";
import { runtime, useGame, type PlayFloor } from "../store";
import { baseTexture } from "../textures";
import { stalkerSkin, useCreature, useStalker } from "./Creature";
import { collide } from "./Player";
import { foes, hurtPlayer } from "../combat";
import { audio } from "../audio";

/** Distance from the player to every visible creature; the radio listens to it. */
export const threatDistances = new Map<string, number>();

const flesh = () => new THREE.MeshStandardMaterial({ color: "#2a1916", roughness: 0.34, metalness: 0.05, transparent: true });

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

// ------------------------------------------------------------------ the hunt

type Mode = "wander" | "chase" | "windup" | "recover" | "stagger" | "dead";

interface Hunter {
  pos: THREE.Vector3;
  heading: number;
  speed: number;
  mode: Mode;
  timer: number;
  hp: number;
  target: THREE.Vector3;
  fall: number;
}

const newHunter = (start: V2, area: { min: V2; max: V2 }, hp: number): Hunter => ({
  pos: new THREE.Vector3(start[0], 0, start[1]),
  heading: Math.PI,
  speed: 0,
  mode: "wander",
  timer: 0,
  hp,
  target: randomIn(area),
  fall: 0,
});

/** Shared behaviour: wander until it senses you, close in, wind up, strike.
 *  The flashlight slows it; the pipe staggers and eventually kills it. */
function stepHunter(
  h: Hunter,
  dt: number,
  area: { min: V2; max: V2 },
  boxes: Box[],
  o: { sense: number; chase: number; wander: number; damage: number; windup: number },
) {
  const vx = runtime.pos.x - h.pos.x;
  const vz = runtime.pos.z - h.pos.z;
  const d = Math.hypot(vx, vz);
  const lit = isLit(h.pos.x, h.pos.z, 12, 0.42);
  const g = useGame.getState();
  const busy = !!g.activeTool || !!g.overlay || g.dead;
  let speed = 0;
  let dir = h.heading;
  h.timer -= dt;
  switch (h.mode) {
    case "wander": {
      const dx = h.target.x - h.pos.x;
      const dz = h.target.z - h.pos.z;
      if (Math.hypot(dx, dz) < 0.4) h.target = randomIn(area);
      dir = Math.atan2(dx, dz);
      speed = o.wander;
      if (!busy && d < o.sense * (runtime.dread > 0.5 ? 1.5 : 1)) h.mode = "chase";
      break;
    }
    case "chase":
      dir = Math.atan2(vx, vz);
      speed = o.chase * (lit ? 0.45 : 1);
      if (busy || d > o.sense * 1.8) h.mode = "wander";
      else if (d < 1.25) {
        h.mode = "windup";
        h.timer = o.windup;
      }
      break;
    case "windup":
      dir = Math.atan2(vx, vz);
      if (h.timer <= 0) {
        if (d < 1.7 && !busy) hurtPlayer(o.damage);
        h.mode = "recover";
        h.timer = 0.9;
      }
      break;
    case "recover":
    case "stagger":
      if (h.timer <= 0) h.mode = "chase";
      break;
    case "dead":
      h.fall = Math.min(1, h.fall + dt * 1.8);
      break;
  }
  if (speed > 0) {
    const turn = Math.atan2(Math.sin(dir - h.heading), Math.cos(dir - h.heading));
    h.heading += turn * (1 - Math.exp(-dt * 5));
    h.pos.x += Math.sin(h.heading) * speed * dt;
    h.pos.z += Math.cos(h.heading) * speed * dt;
    collide(h.pos, boxes, 0.32);
    h.pos.x = THREE.MathUtils.clamp(h.pos.x, area.min[0], area.max[0]);
    h.pos.z = THREE.MathUtils.clamp(h.pos.z, area.min[1], area.max[1]);
  } else if (h.mode === "windup") {
    const turn = Math.atan2(Math.sin(dir - h.heading), Math.cos(dir - h.heading));
    h.heading += turn * (1 - Math.exp(-dt * 8));
  }
  h.speed += (speed - h.speed) * (1 - Math.exp(-dt * 5));
  return { d, lit };
}

/** Register a hunter so the pipe can find it. */
function useFoe(id: string, h: Hunter, maxHp: number, onDeath?: () => void) {
  useEffect(() => {
    const knock = new THREE.Vector3();
    foes.set(id, {
      pos: h.pos,
      get alive() {
        return h.mode !== "dead";
      },
      hit: (dmg, from) => {
        if (h.mode === "dead") return;
        h.hp -= dmg;
        knock.set(h.pos.x - from.x, 0, h.pos.z - from.z).normalize().multiplyScalar(0.55);
        h.pos.add(knock);
        if (h.hp <= 0) {
          h.mode = "dead";
          audio.creak();
          onDeath?.();
        } else {
          h.mode = "stagger";
          h.timer = 0.6;
        }
      },
    });
    return () => void foes.delete(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  void maxHp;
}

// ------------------------------------------------------------------ lying figure

/** Faceless figure bound in its own skin. Wanders, writhes, and shrinks from light. */
function LyingFigure({ id, area, boxes, start }: { id: string; area: { min: V2; max: V2 }; boxes: Box[]; start: V2 }) {
  const root = useRef<THREE.Group>(null!);
  const mat = useMemo(flesh, []);
  const creature = useCreature(mat);
  const h = useRef(newHunter(start, area, 100)).current;
  const twitch = useRef(0);
  useFoe(id, h, 100);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = clock.elapsedTime;
    const { d, lit } = stepHunter(h, dt, area, boxes, { sense: 8, chase: 1.35, wander: 0.5, damage: 12, windup: 0.55 });
    // writhing: constant unease, violent spasms when lit, hit or striking
    twitch.current = Math.max(0, twitch.current - dt);
    if (Math.random() < (lit || h.mode === "windup" || h.mode === "stagger" ? 0.3 : 0.015)) twitch.current = 0.12 + Math.random() * 0.25;
    if (h.mode !== "dead") creature.update(dt, h.speed, twitch.current > 0, t);
    root.current.position.set(h.pos.x, -h.fall * 0.15, h.pos.z);
    root.current.rotation.set(-h.fall * 1.45, h.heading, 0);
    mat.opacity = 1;
    mat.transparent = false;
    mat.color.setRGB(0.05 + runtime.dread * 0.03, 0.018, 0.014);
    threatDistances.set(id, h.mode === "dead" ? 99 : d);
  });

  return (
    <group ref={root}>
      <primitive object={creature.model} />
    </group>
  );
}

// ------------------------------------------------------------------ the stalker

/** Follows at a distance. When the flashlight finds it, it freezes. */
function Stalker({ id, area, boxes, start }: { id: string; area: { min: V2; max: V2 }; boxes: Box[]; start: V2 }) {
  const root = useRef<THREE.Group>(null!);
  const skin = useMemo(stalkerSkin, []);
  const body = useStalker(skin);
  const h = useRef(newHunter(start, area, 170)).current;
  useFoe(id, h, 170);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = clock.elapsedTime;
    const { d, lit } = stepHunter(h, dt, area, boxes, { sense: 11, chase: 1.75, wander: 0.4, damage: 20, windup: 0.7 });
    if (h.mode !== "dead") body.update(dt, h.speed, lit || h.mode === "windup" || h.mode === "stagger", t);
    root.current.position.set(h.pos.x, -h.fall * 0.2, h.pos.z);
    root.current.rotation.set(-h.fall * 1.45, h.heading, 0);
    skin.opacity = 1;
    threatDistances.set(id, h.mode === "dead" ? 99 : d);
  });

  return (
    <group ref={root}>
      <primitive object={body.model} />
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
        {intense && <Stalker id="1f-s" area={{ min: [-9, -7], max: [9, 7] }} boxes={boxes} start={[-8, 6]} />}
        {nightmare && <Watcher id="1f-w" at={[-7.6, -6.6]} yaw={0.6} />}
      </group>
    );
  }
  if (floor === "ROOF") {
    return (
      <group>
        <FogShadows count={intense ? 6 : 3} areas={layout.rects} minDist={8} maxDist={18} />
        {intense && <Stalker id="r-s" area={{ min: [-11, -13], max: [11, 1] }} boxes={boxes} start={[10, -12]} />}
        {nightmare && <Watcher id="r-w" at={[9.5, -12.5]} yaw={-0.5} />}
      </group>
    );
  }
  // corridors: everything lives in the long main hall
  const c = layout.rects[0];
  const zMin = floor === "B1" ? B1_BARS_Z + 1 : c.min[1] + 1;
  const zMax = c.max[1];
  const len = zMax - zMin;
  const far: V2 = [0, zMin + 2];
  const deep = floor === "B1" || floor === "B2";
  return (
    <group>
      <FogShadows count={intense ? 5 : 2} areas={[{ min: [-1.4, zMin], max: [1.4, zMax - 10] }]} minDist={7} maxDist={18} />
      <LyingFigure id={`${floor}-a`} area={{ min: [-1.2, zMin], max: [1.2, zMax - 11] }} boxes={boxes} start={[0, zMin + len * 0.3]} />
      {(floor !== "3F" || intense) && <Stalker id={`${floor}-s`} area={{ min: [-1.2, zMin], max: [1.2, zMax - 1.5] }} boxes={boxes} start={far} />}
      {(intense || deep) && <LyingFigure id={`${floor}-b`} area={{ min: [-1.2, zMin + len * 0.4], max: [1.2, zMax - 1.5] }} boxes={boxes} start={[0.5, zMin + len * 0.55]} />}
      {nightmare && <Watcher id={`${floor}-w`} at={[0, zMin + 0.1]} yaw={0} />}
    </group>
  );
}
