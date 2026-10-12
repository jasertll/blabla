"use client";

import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { DIALOGUE } from "../config/dialogue";
import { roomGeometry, WARD_SPECS } from "../floors";
import type { V2 } from "../level";
import { M } from "../materials";
import { runtime, useGame, type PlayFloor } from "../store";
import { audio } from "../audio";
import { usePerson, ELENA_URL, WALTER_URL } from "./Creature";

// People who are still here. Walk close and they stop you; afterwards you can
// talk to them again with E.

/** Spots where "Talk to …" can be offered (read by <Interaction/>). */
/** When the last conversation ended: nobody stops you again straight away. */
export const dialogueClock = { endedAt: 0 };
const fresh = () => performance.now() - dialogueClock.endedAt > 9000;

export const npcSpots = new Map<string, { x: number; z: number; label: string }>();

export function startDialogue(id: string, at: V2) {
  const g = useGame.getState();
  const script = DIALOGUE[id];
  if (!script || g.overlay || g.activeTool || g.dead) return;
  runtime.path = [];
  runtime.keys.clear();
  // over the shoulder, toward their face
  const dx = at[0] - runtime.pos.x;
  const dz = at[1] - runtime.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const ux = dx / d;
  const uz = dz / d;
  runtime.focus = {
    cam: new THREE.Vector3(runtime.pos.x - ux * 1.1 + uz * 0.55, 1.75, runtime.pos.z - uz * 1.1 - ux * 0.55),
    look: new THREE.Vector3(at[0], 1.5, at[1]),
  };
  const node = script.start(g.flags);
  g.setDialogue({ id, node, line: 0 });
  g.setOverlay("dialogue");
  const first = script.nodes[node]?.lines[0];
  if (first?.who === "npc") audio.voice(Math.max(1.4, first.text.length * 0.05), script.pitch);
}

interface PersonProps {
  id: string;
  url: string;
  at: V2;
  yaw: number;
  ghost?: boolean;
  show: (f: string[]) => boolean;
  /** Stops you without being asked. */
  auto: (f: string[]) => boolean;
  /** Fade away once this flag is set. */
  leaveOn?: string;
}

function Person({ id, url, at, yaw, ghost, show, auto, leaveOn }: PersonProps) {
  const p = usePerson(url, { ghost });
  const root = useRef<THREE.Group>(null!);
  useEffect(() => () => void npcSpots.delete(id), [id]);
  const op = useRef(ghost ? 0 : 1);
  useFrame(({ clock }, dt) => {
    const g = useGame.getState();
    const visible = show(g.flags) && !(leaveOn && g.flags.includes(leaveOn) && g.overlay !== "dialogue");
    op.current += ((visible ? 1 : 0) - op.current) * (1 - Math.exp(-dt * (visible ? 1.5 : 0.8)));
    p.setOpacity(ghost ? op.current : visible ? 1 : 0);
    if (!visible) {
      npcSpots.delete(id);
      return;
    }
    p.breathe(clock.elapsedTime);
    // they watch you
    const dx = runtime.pos.x - at[0];
    const dz = runtime.pos.z - at[1];
    const d = Math.hypot(dx, dz);
    if (d < 7) {
      const want = Math.atan2(dx, dz) - yaw;
      const turn = THREE.MathUtils.clamp(Math.atan2(Math.sin(want), Math.cos(want)), -0.9, 0.9);
      p.bones.Neck?.rotateY(turn * 0.45);
      p.bones.Head?.rotateY(turn * 0.45);
    }
    npcSpots.set(id, { x: at[0], z: at[1], label: `Talk to ${DIALOGUE[id].name.split(" ")[0].toLowerCase().replace(/^./, (c) => c.toUpperCase())}` });
    if (d < 2.8 && fresh() && auto(g.flags) && !g.overlay && !g.activeTool && op.current > 0.6) startDialogue(id, at);
  });
  return (
    <group ref={root} position={[at[0], 0, at[1]]} rotation={[0, yaw, 0]}>
      <primitive object={p.model} />
    </group>
  );
}

/** A wall speaker. The Director only ever talks through these. */
function Intercom({ id, at, yaw }: { id: string; at: V2; yaw: number }) {
  const lamp = useRef<THREE.MeshStandardMaterial>(null!);
  useEffect(() => () => void npcSpots.delete(id), [id]);
  useFrame(({ clock }) => {
    const g = useGame.getState();
    const talking = g.overlay === "dialogue" && g.dialogue?.id === id;
    lamp.current.emissiveIntensity = talking ? 2 + Math.sin(clock.elapsedTime * 20) : 0.4;
    const d = Math.hypot(runtime.pos.x - at[0], runtime.pos.z - at[1]);
    npcSpots.set(id, { x: at[0], z: at[1], label: "Press the intercom" });
    if (d < 3.2 && fresh() && !g.flags.includes(`met:${id}`) && !g.overlay && !g.activeTool) startDialogue(id, at);
  });
  return (
    <group position={[at[0], 1.9, at[1]]} rotation={[0, yaw, 0]}>
      <mesh material={M.plastic}>
        <boxGeometry args={[0.28, 0.36, 0.06]} />
      </mesh>
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={i} position={[0, 0.08 - i * 0.035, 0.032]} material={M.darkMetal}>
          <boxGeometry args={[0.2, 0.012, 0.005]} />
        </mesh>
      ))}
      <mesh position={[0.09, -0.13, 0.035]}>
        <sphereGeometry args={[0.014, 8, 8]} />
        <meshStandardMaterial ref={lamp} color="#300" emissive="#ff2a10" />
      </mesh>
    </group>
  );
}

export function People({ floor }: { floor: PlayFloor }) {
  const dirRoom = useMemo(() => roomGeometry(WARD_SPECS["4F"]).rooms.find((r) => r.spec.room === "DIR"), []);
  return (
    <Suspense fallback={null}>
      {floor === "1F" && (
        <Person
          id="walter"
          url={WALTER_URL}
          at={[7.4, 3.2]}
          yaw={-Math.PI / 2 - 0.4}
          show={() => true}
          auto={(f) => !f.includes("met:walter") || (f.includes("solved:capture") && !f.includes("walter:capture"))}
        />
      )}
      {floor === "2F" && (
        <Person
          id="elena"
          url={ELENA_URL}
          ghost
          at={[-4.4, -5.4]}
          yaw={Math.PI / 2}
          show={(f) => f.includes("read:diary-201") && !f.includes("met:elena")}
          auto={(f) => !f.includes("met:elena")}
          leaveOn="met:elena"
        />
      )}
      {floor === "4F" && dirRoom && <Intercom id="director" at={[dirRoom.xIn + 0.15, dirRoom.zDoor - 1.6]} yaw={Math.PI / 2} />}
    </Suspense>
  );
}
