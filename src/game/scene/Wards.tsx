"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, use, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { loadGLTF } from "../assets";
import { cellEmptied, phone } from "../events";
import { B1_BARS_Z, DEPTH, HALF, roomGeometry, type WardSpec } from "../floors";
import type { V3 } from "../level";
import { M } from "../materials";
import { runtime, useGame } from "../store";
import { baseTexture, writingTexture } from "../textures";
import { Decal, Door, ElevatorDoors, Fluorescent, Gurney, Wheelchair } from "./Building";
import { CREATURE_URL } from "./Creature";
import { Instrument, Lamp, Sheet } from "./Instruments";
import { BarredWindow, BedsideCabinet, BrokenCeiling, FireCabinet, Handrail, HangingSign, HospitalBed, IVStand, LinenCart, NoticeBoard, WallClock, Wardrobe } from "./Props";

// ------------------------------------------------------------------ generated wards

export function GenericWard({ spec }: { spec: WardSpec }) {
  const { rooms, zEnd } = useMemo(() => roomGeometry(spec), [spec]);
  const H = spec.height;
  const rails = useMemo(() => {
    const out: { side: 1 | -1; a: number; b: number }[] = [];
    for (const side of [-1, 1] as const) {
      const gaps = rooms
        .filter((r) => r.spec.side === side)
        .map((r) => r.zDoor)
        .sort((a, b) => b - a);
      let z = 3.4;
      for (const g of gaps) {
        out.push({ side, a: z, b: g + 0.75 });
        z = g - 0.75;
      }
      out.push({ side, a: z, b: zEnd + 0.4 });
    }
    return out.filter((r) => r.a - r.b > 0.6);
  }, [rooms, zEnd]);
  const lights = useMemo(() => {
    const out: number[] = [];
    for (let z = 0; z > zEnd + 1; z -= 7.5) out.push(z);
    return out;
  }, [zEnd]);

  return (
    <group>
      <ElevatorDoors position={[0, 0, 3.89]} rotY={Math.PI} floorLabel={spec.id} />
      <HangingSign position={[0, 0, -0.4]} text={spec.sign} height={H} />
      {lights.map((z, i) => (
        <Fluorescent key={z} position={[0, H - 0.05, z]} flicker={i % 3 === 1 ? "broken" : "subtle"} intensity={spec.id === "B1" ? 3.4 : 4.5} length={1.1} />
      ))}
      {rails.map((r, i) => (
        <Handrail key={i} position={[r.side * (HALF - 0.11), 0, r.side < 0 ? r.a : r.b]} rotY={r.side < 0 ? Math.PI / 2 : -Math.PI / 2} length={r.a - r.b} />
      ))}
      {rooms.map((r) => {
        const s = r.spec.side;
        const back = s * (HALF + DEPTH);
        const mid = s * (HALF + DEPTH / 2);
        return (
          <group key={r.spec.room}>
            <Door position={[s * (HALF - 0.11), 0, r.zDoor]} rotY={-s * (Math.PI / 2)} label={r.spec.room} open={1.9} />
            <Instrument kind={r.spec.object} position={[back - s * 0.1, 0, r.zDoor]} rotY={-s * (Math.PI / 2)} />
            <Fluorescent position={[mid, H - 0.05, r.zDoor]} flicker={r.spec.room.endsWith("2") ? "broken" : "subtle"} intensity={2.4} length={1.1} />
            {r.spec.writing && (
              <Decal position={[back - s * 0.12, 2.35, r.zDoor - 1.8]} rotation={[0, -s * (Math.PI / 2), 0]} size={[2.6, 0.7]} map={writingTexture(r.spec.writing)} opacity={0.85} />
            )}
            {r.spec.memo && <Sheet position={[s * (HALF + 2.2), 0.012, r.zDoor - 2.2]} rotation={[-Math.PI / 2, 0, 0.5]} seed={r.zDoor} />}
            <RoomDressing floor={spec.id} side={s} zTop={r.zTop} zBot={r.zBot} H={H} />
          </group>
        );
      })}
      {/* dead end */}
      {spec.id !== "B1" && <Door position={[0, 0, zEnd + 0.11]} label="STAIRS" />}
      <FloorDetails spec={spec} zEnd={zEnd} />
    </group>
  );
}

/** A little of the room's previous life, along the side walls. */
function RoomDressing({ floor, side, zTop, zBot, H }: { floor: string; side: 1 | -1; zTop: number; zBot: number; H: number }) {
  const x = side * (HALF + 3.6);
  const bed = floor === "3F" || floor === "B1";
  return (
    <group>
      {bed ? (
        <HospitalBed position={[x, 0, zBot + 0.6]} rotY={0} bloody={floor === "B1"} />
      ) : (
        <Wardrobe position={[x + side * 1.6, 0, zBot + 0.4]} rotY={0} />
      )}
      <BarredWindow position={[side * (HALF + DEPTH - 0.13), 1.75, zTop - 1.2]} rotY={-side * (Math.PI / 2)} w={1.2} h={1.0} />
      {floor === "4F" && <BedsideCabinet position={[side * (HALF + 0.5), 0, zTop - 0.5]} rotY={Math.PI} />}
      {floor === "B2" && <IVStand position={[side * (HALF + 1.0), 0, zBot + 1.0]} tilt={0.2} />}
      {H > 3.5 && floor === "4F" && <BrokenCeiling position={[side * (HALF + 3), 0, (zTop + zBot) / 2]} height={H} />}
    </group>
  );
}

function FloorDetails({ spec, zEnd }: { spec: WardSpec; zEnd: number }) {
  if (spec.id === "3F")
    return (
      <group>
        <NurseStation />
        <Wheelchair position={[-1.2, 0, -9]} rotY={0.6} />
        <LinenCart position={[1.25, 0, -14]} rotY={-Math.PI / 2} />
        <NoticeBoard position={[-1.68, 1.5, -2.5]} rotY={Math.PI / 2} />
        <Decal position={[0, 0.012, -11]} rotation={[-Math.PI / 2, 0, 0.3]} size={[2.4, 1.6]} map={baseTexture("blood")} opacity={0.5} />
      </group>
    );
  if (spec.id === "4F")
    return (
      <group>
        <WallClock position={[1.68, 2.5, -2.5]} rotY={-Math.PI / 2} />
        <FireCabinet position={[-1.62, 1.1, -10]} rotY={Math.PI / 2} />
        <Decal position={[1.68, 1.9, -15.5]} rotation={[0, -Math.PI / 2, 0]} size={[3.4, 0.85]} map={writingTexture("THEY WATCH THURSDAYS")} opacity={0.85} />
      </group>
    );
  if (spec.id === "B1")
    return (
      <group>
        <Gurney position={[1.15, 0, -6]} rotY={Math.PI / 2} />
        <Gurney position={[-1.15, 0, -22]} rotY={Math.PI / 2 + 0.1} />
        <MorgueDrawers z={-8.2} />
        <Bars z={B1_BARS_Z} />
        <Cell zBars={B1_BARS_Z} zEnd={zEnd} />
        <Decal position={[0, 0.012, -15]} rotation={[-Math.PI / 2, 0, 1.2]} size={[3, 2.2]} map={baseTexture("blood")} opacity={0.8} />
        <Decal position={[-1.68, 1.9, -27]} rotation={[0, Math.PI / 2, 0]} size={[3.4, 0.85]} map={writingTexture("SHE KNOWS YOU CAME")} opacity={0.85} />
      </group>
    );
  return (
    <group>
      <IVStand position={[1.2, 0, -5]} tilt={0.3} />
      <Gurney position={[-1.15, 0, -14]} rotY={Math.PI / 2} />
      <Decal position={[-1.68, 1.9, -9]} rotation={[0, Math.PI / 2, 0]} size={[3.4, 0.85]} map={writingTexture("CHECK THE HEADERS")} opacity={0.85} />
    </group>
  );
}

// ------------------------------------------------------------------ 3F: the phone

function NurseStation() {
  const handset = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    const r = phone.ringing ? Math.sin(clock.elapsedTime * 120) * 0.02 : 0;
    handset.current.position.y = 0.9 + Math.abs(r) * 0.5;
    handset.current.rotation.z = r;
  });
  return (
    <group position={[1.38, 0, 0.7]}>
      <mesh position={[0, 0.5, 0]} material={M.laminate} castShadow receiveShadow>
        <boxGeometry args={[0.7, 1.0, 1.8]} />
      </mesh>
      <mesh position={[-0.05, 1.02, 0]} material={M.darkWood}>
        <boxGeometry args={[0.85, 0.04, 1.9]} />
      </mesh>
      {/* black rotary phone */}
      <group position={[-0.15, 0, 0]}>
        <mesh position={[0, 1.09, 0]} material={M.blackPlastic}>
          <boxGeometry args={[0.2, 0.1, 0.22]} />
        </mesh>
        <mesh position={[-0.07, 1.12, 0]} rotation={[0, 0, Math.PI / 2 - 0.4]} material={M.metal}>
          <cylinderGeometry args={[0.06, 0.06, 0.01, 16]} />
        </mesh>
        <group ref={handset} position={[0, 0.9, 0]}>
          <mesh position={[0.02, 0.27, 0]} material={M.blackPlastic}>
            <boxGeometry args={[0.06, 0.04, 0.26]} />
          </mesh>
        </group>
        {/* the cord, cut */}
        <mesh position={[0.15, 0.6, 0.14]} rotation={[0.2, 0, 0.1]} material={M.blackPlastic}>
          <cylinderGeometry args={[0.005, 0.005, 0.85, 4]} />
        </mesh>
      </group>
      <Sheet position={[-0.15, 1.045, 0.75]} rotation={[-Math.PI / 2, 0, 0.3]} size={[0.15, 0.1]} seed={88} />
      <Lamp position={[-0.4, 2.3, 0.3]} color="#d6e0d0" intensity={1.6} />
    </group>
  );
}

// ------------------------------------------------------------------ B1: the morgue and the cell

function MorgueDrawers({ z }: { z: number }) {
  return (
    <group position={[1.62, 0, z]} rotation={[0, -Math.PI / 2, 0]}>
      {[0, 1, 2].map((c) =>
        [0, 1, 2].map((r) => (
          <group key={`${c}${r}`} position={[(c - 1) * 0.72, 0.45 + r * 0.7, 0]}>
            <mesh material={M.metal}>
              <boxGeometry args={[0.66, 0.62, 0.06]} />
            </mesh>
            <mesh position={[0.22, 0, 0.05]} material={M.darkMetal}>
              <boxGeometry args={[0.12, 0.04, 0.04]} />
            </mesh>
          </group>
        )),
      )}
    </group>
  );
}

function Bars({ z }: { z: number }) {
  return (
    <group position={[0, 0, z]}>
      {Array.from({ length: 19 }, (_, i) => (
        <mesh key={i} position={[-HALF + 0.1 + i * 0.19, spec_h / 2, 0]} material={M.rustMetal} castShadow>
          <cylinderGeometry args={[0.018, 0.018, spec_h, 6]} />
        </mesh>
      ))}
      {[0.15, 1.2, spec_h - 0.15].map((y) => (
        <mesh key={y} position={[0, y, 0]} material={M.rustMetal}>
          <boxGeometry args={[HALF * 2, 0.06, 0.05]} />
        </mesh>
      ))}
    </group>
  );
}
const spec_h = 3.2;

const gown = new THREE.MeshStandardMaterial({ color: "#8f978f", roughness: 0.9, transparent: true });

/** She stands with her back to you. Look away, and she is gone. */
function Cell({ zBars, zEnd }: { zBars: number; zEnd: number }) {
  const gone = useGame((s) => s.flags.includes("cell-empty"));
  return (
    <group>
      <HospitalBed position={[-0.9, 0, zEnd + 1.2]} rotY={Math.PI / 2} bloody={false} />
      <mesh position={[0.6, 0.012, zEnd + 0.9]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.04, 0.05, 16]} />
        <meshStandardMaterial color="#d6d0bd" />
      </mesh>
      <pointLight position={[0, 2.6, (zBars + zEnd) / 2]} color="#9fb0a6" intensity={1.6} distance={4} decay={2} />
      {!gone && (
        <Suspense fallback={null}>
          <CellFigure at={[0.35, (zBars + zEnd) / 2 + 0.1]} />
        </Suspense>
      )}
    </group>
  );
}

function CellFigure({ at }: { at: [number, number] }) {
  const gltf = use(loadGLTF(CREATURE_URL));
  const camera = useThree((s) => s.camera);
  const rig = useMemo(() => {
    const model = clone(gltf.scene);
    model.scale.setScalar(0.98);
    const bones: Record<string, THREE.Bone> = {};
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = gown;
        m.castShadow = true;
        m.frustumCulled = false;
      }
    });
    const mixer = new THREE.AnimationMixer(model);
    const idle = gltf.animations.find((a) => a.name === "idle");
    if (idle) mixer.clipAction(idle).play();
    return { model, mixer, bones };
  }, [gltf]);
  const st = useRef({ seen: 0, away: 0, fading: false });
  const v = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    gown.opacity = 1;
  }, []);

  useFrame(({ clock }, dt) => {
    rig.mixer.update(dt * 0.4);
    const b = rig.bones;
    b.mixamorigHead?.rotation.set(0.55 + Math.sin(clock.elapsedTime * 0.7) * 0.03, 0, 0.15);
    b.mixamorigSpine2?.rotation.set(0.15, 0, Math.sin(clock.elapsedTime * 9) * 0.01);
    const s = st.current;
    v.set(at[0], 1.2, at[1]).project(camera);
    const inView = v.z < 1 && Math.abs(v.x) < 0.85 && Math.abs(v.y) < 0.9;
    const d = Math.hypot(at[0] - runtime.pos.x, at[1] - runtime.pos.z);
    if (inView && d < 16) s.seen += dt;
    if (s.seen > 1.2 && !inView) s.away += dt;
    else s.away = 0;
    if (s.away > 0.5 && !s.fading) {
      s.fading = true;
      gown.opacity = 0;
      cellEmptied();
    }
  });

  return (
    <group position={[at[0], 0, at[1]]} rotation={[0, Math.PI, 0]}>
      <primitive object={rig.model} />
    </group>
  );
}

// ------------------------------------------------------------------ 2F: the mirror

/** After the diary, the mirror over the sink in 201 changes. */
export function MirrorGhost({ position, rotY }: { position: V3; rotY: number }) {
  const changed = useGame((s) => s.flags.includes("mirror-changed"));
  const mat = useRef<THREE.MeshBasicMaterial>(null!);
  const t0 = useRef(0);
  useFrame(({ clock }) => {
    if (!changed) return;
    if (!t0.current) t0.current = clock.elapsedTime;
    const k = clock.elapsedTime - t0.current;
    // a face held for a moment, then only the writing remains
    mat.current.opacity = k < 2.5 ? 0.9 : Math.max(0, 0.9 - (k - 2.5) * 0.5);
  });
  if (!changed) return null;
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 1.5, 0.045]}>
        <planeGeometry args={[0.44, 0.6]} />
        <meshBasicMaterial ref={mat} map={baseTexture("silhouette")} transparent opacity={0.9} depthWrite={false} color="#ffb0a0" />
      </mesh>
      <mesh position={[0, 1.5, 0.05]}>
        <planeGeometry args={[0.44, 0.3]} />
        <meshBasicMaterial map={writingTexture("SHE'S STILL HERE")} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------ the roof

export function Roof() {
  const read = useGame((s) => s.flags.includes("read:elena-final"));
  return (
    <group>
      {/* elevator housing */}
      <mesh position={[0, 1.6, 4.1]} material={M.laminate} castShadow receiveShadow>
        <boxGeometry args={[4.4, 3.2, 3.8]} />
      </mesh>
      <ElevatorDoors position={[0, 0, 2.18]} rotY={Math.PI} floorLabel="R" />
      <Lamp position={[0, 2.9, 1.6]} color="#ffb070" intensity={3} distance={6} />
      {/* the telescope */}
      <group position={[0, 0, -8.6]}>
        <mesh position={[0, 0.6, 0]} material={M.rustMetal} castShadow>
          <cylinderGeometry args={[0.06, 0.25, 1.2, 8]} />
        </mesh>
        <mesh position={[0, 1.55, 0.1]} rotation={[-0.9, 0, 0]} material={M.rustMetal} castShadow>
          <cylinderGeometry args={[0.13, 0.17, 1.9, 14]} />
        </mesh>
        <mesh position={[0, 1.2, 0]} material={M.darkMetal}>
          <sphereGeometry args={[0.12, 10, 8]} />
        </mesh>
      </group>
      {/* water tower, and behind it, something that shouldn't be up here */}
      <group position={[-8.5, 0, -10.5]}>
        {[-1, 1].flatMap((x) =>
          [-1, 1].map((z) => (
            <mesh key={`${x}${z}`} position={[x * 1.4, 1.5, z * 1.4]} material={M.rustMetal} castShadow>
              <cylinderGeometry args={[0.07, 0.07, 3, 6]} />
            </mesh>
          )),
        )}
        <mesh position={[0, 4.2, 0]} material={M.darkWood} castShadow>
          <cylinderGeometry args={[2.0, 2.0, 2.6, 18]} />
        </mesh>
        <mesh position={[0, 5.8, 0]} material={M.rustMetal} castShadow>
          <coneGeometry args={[2.15, 0.8, 18]} />
        </mesh>
      </group>
      <Arcade position={[-8.5, 0, -13.75]} />
      {/* vents */}
      {[5.6, 7.4].map((x) => (
        <mesh key={x} position={[x, 0.7, -2]} material={M.metal} castShadow>
          <boxGeometry args={[1.5, 1.4, 1.8]} />
        </mesh>
      ))}
      {/* the note on the ledge */}
      <group position={[6, 1.16, -13.75]}>
        <mesh material={M.laminate}>
          <boxGeometry args={[0.24, 0.08, 0.18]} />
        </mesh>
        <Sheet position={[0.1, 0.05, 0.02]} rotation={[-Math.PI / 2, 0, 0.2]} size={[0.18, 0.24]} seed={99} />
      </group>
      {!read && (
        <Suspense fallback={null}>
          <LedgeFigure at={[6.6, -13.6]} />
        </Suspense>
      )}
      <TownBelow />
      <hemisphereLight args={["#9aa19c", "#1d1f1d", 0.5]} />
    </group>
  );
}

function Arcade({ position }: { position: V3 }) {
  const screen = useRef<THREE.MeshBasicMaterial>(null!);
  useFrame(({ clock }) => {
    screen.current.color.setHSL((clock.elapsedTime * 0.1) % 1, 0.7, 0.45 + Math.sin(clock.elapsedTime * 3) * 0.1);
  });
  return (
    <group position={position}>
      <mesh position={[0, 0.9, 0]} material={M.blackPlastic} castShadow>
        <boxGeometry args={[0.75, 1.8, 0.7]} />
      </mesh>
      <mesh position={[0, 1.3, 0.36]} rotation={[-0.15, 0, 0]}>
        <planeGeometry args={[0.55, 0.42]} />
        <meshBasicMaterial ref={screen} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.95, 0.42]} rotation={[-0.6, 0, 0]} material={M.darkMetal}>
        <boxGeometry args={[0.7, 0.04, 0.25]} />
      </mesh>
      <pointLight position={[0, 1.4, 0.9]} color="#7a4cff" intensity={1.8} distance={3.5} />
    </group>
  );
}

/** Someone standing on the parapet, facing the fog. Gone before you reach them. */
function LedgeFigure({ at }: { at: [number, number] }) {
  const gltf = use(loadGLTF(CREATURE_URL));
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2b2e2c", roughness: 1, transparent: true }), []);
  const rig = useMemo(() => {
    const m = clone(gltf.scene);
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = mat;
        mesh.frustumCulled = false;
      }
    });
    const mixer = new THREE.AnimationMixer(m);
    const idle = gltf.animations.find((a) => a.name === "idle");
    if (idle) mixer.clipAction(idle).play();
    const sad = gltf.animations.find((a) => a.name === "sad_pose");
    if (sad) mixer.clipAction(sad).play();
    return { m, mixer };
  }, [gltf, mat]);
  useFrame((_, dt) => {
    rig.mixer.update(dt);
    const model = rig.m;
    const d = Math.hypot(at[0] - runtime.pos.x, at[1] - runtime.pos.z);
    const want = d < 6 ? 0 : 1;
    mat.opacity += (want - mat.opacity) * (1 - Math.exp(-dt * (want ? 0.3 : 2.5)));
    model.visible = mat.opacity > 0.02;
  });
  return (
    <group position={[at[0], 1.15, at[1]]} rotation={[0, Math.PI, 0]}>
      <primitive object={rig.m} />
    </group>
  );
}

/** Faint lights of the town through the fog, far below the parapet. */
function TownBelow() {
  const pts = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = 260;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 26 + Math.random() * 60;
      a[i * 3] = Math.cos(ang) * r;
      a[i * 3 + 1] = -18 - Math.random() * 6;
      a[i * 3 + 2] = Math.sin(ang) * r - 4;
    }
    g.setAttribute("position", new THREE.BufferAttribute(a, 3));
    return g;
  }, []);
  return (
    <points geometry={pts}>
      <pointsMaterial color="#ffb36a" size={0.5} sizeAttenuation transparent opacity={0.6} fog={false} />
    </points>
  );
}

