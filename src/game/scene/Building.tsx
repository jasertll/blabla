"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { FloorLayout, V3 } from "../level";
import { walkTo } from "../actions";
import { M, releaseSurface, surface } from "../materials";
import { runtime, useGame } from "../store";
import { baseTexture, writingTexture } from "../textures";
import { getScreens } from "./screens";
import {
  BedsideCabinet,
  BrokenCeiling,
  DeadPlant,
  FireCabinet,
  Handrail,
  HangingSign,
  HospitalBed,
  IVStand,
  LinenCart,
  NoticeBoard,
  SinkMirror,
  WaitingChairs,
  Wardrobe,
  WallClock,
} from "./Props";
import { ThreatGlobe } from "./ThreatGlobe";

// ------------------------------------------------------------------ shell

export function Shell({ layout }: { layout: FloorLayout }) {
  const parts = useMemo(() => {
    const H = layout.height;
    const floors = layout.rects.map((r) => {
      const w = r.max[0] - r.min[0];
      const d = r.max[1] - r.min[1];
      return {
        pos: [(r.min[0] + r.max[0]) / 2, 0, (r.min[1] + r.max[1]) / 2] as V3,
        w,
        d,
        floor: surface("floor", w / 4, d / 4),
        ceil: surface("ceiling", w / 1.2, d / 1.2),
      };
    });
    const walls = layout.walls.map(({ a, b }) => {
      const horizontal = a[1] === b[1];
      const L = horizontal ? Math.abs(b[0] - a[0]) : Math.abs(b[1] - a[1]);
      return {
        pos: [(a[0] + b[0]) / 2, H / 2, (a[1] + b[1]) / 2] as V3,
        rotY: horizontal ? 0 : Math.PI / 2,
        L,
        mat: surface("wall", L / H, 1),
      };
    });
    return { floors, walls, H };
  }, [layout]);

  useEffect(
    () => () => {
      parts.floors.forEach((f) => {
        releaseSurface(f.floor);
        releaseSurface(f.ceil);
      });
      parts.walls.forEach((w) => releaseSurface(w.mat));
    },
    [parts],
  );

  return (
    <group>
      {parts.floors.map((f, i) => (
        <group key={i} position={f.pos}>
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            material={f.floor}
            receiveShadow
            onClick={(e) => {
              if (e.delta > 6) return; // a drag, not a click
              e.stopPropagation();
              walkTo(e.point.x, e.point.z);
            }}
          >
            <planeGeometry args={[f.w, f.d]} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, parts.H, 0]} material={f.ceil} receiveShadow>
            <planeGeometry args={[f.w, f.d]} />
          </mesh>
        </group>
      ))}
      {parts.walls.map((w, i) => (
        <mesh key={i} position={w.pos} rotation={[0, w.rotY, 0]} material={w.mat} castShadow receiveShadow>
          <boxGeometry args={[w.L + 0.2, parts.H, 0.2]} />
        </mesh>
      ))}
    </group>
  );
}

// ------------------------------------------------------------------ lights

type Flicker = "steady" | "subtle" | "broken";

export function Fluorescent({ position, flicker = "subtle", intensity = 9, length = 1.4 }: { position: V3; flicker?: Flicker; intensity?: number; length?: number }) {
  const light = useRef<THREE.PointLight>(null!);
  const tube = useMemo(() => M.tube.clone(), []);
  const base = useMemo(() => new THREE.Color("#dfe8dc"), []);
  const red = useMemo(() => new THREE.Color("#ff2a12"), []);
  const state = useRef({ off: 0, next: Math.random() * 4 });

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    let k = 1;
    if (flicker === "subtle") k = 0.92 + Math.sin(t * 50) * 0.02 + (Math.random() < 0.004 ? -0.7 : 0);
    if (flicker === "broken") {
      const s = state.current;
      s.next -= dt;
      if (s.next <= 0) {
        s.off = s.off ? 0 : 1;
        s.next = s.off ? 0.04 + Math.random() * 0.5 : 0.05 + Math.random() * 2.2;
      }
      k = s.off ? 0.02 : 0.7 + Math.random() * 0.3;
    }
    const dread = runtime.dread;
    light.current.intensity = intensity * k * (1 - dread * 0.55);
    light.current.color.copy(base).lerp(red, dread);
    tube.emissive.copy(base).lerp(red, dread);
    tube.emissiveIntensity = 1.6 * k * (1 - dread * 0.4);
  });

  return (
    <group position={position}>
      <mesh material={M.darkMetal}>
        <boxGeometry args={[length + 0.15, 0.06, 0.32]} />
      </mesh>
      <mesh position={[0, -0.045, 0.07]} rotation={[0, 0, Math.PI / 2]} material={tube}>
        <cylinderGeometry args={[0.025, 0.025, length, 8]} />
      </mesh>
      <mesh position={[0, -0.045, -0.07]} rotation={[0, 0, Math.PI / 2]} material={tube}>
        <cylinderGeometry args={[0.025, 0.025, length, 8]} />
      </mesh>
      <pointLight ref={light} position={[0, -0.3, 0]} intensity={intensity} distance={11} decay={1.8} />
    </group>
  );
}

/** Spotlight whose target is part of the scene graph (so it actually aims). */
export function Spot({ position, target, ...props }: { position: V3; target: V3 } & Omit<React.ComponentProps<"spotLight">, "position" | "target">) {
  const t = useMemo(() => new THREE.Object3D(), []);
  t.position.set(...target);
  return (
    <>
      <spotLight position={position} target={t} {...props} />
      <primitive object={t} />
    </>
  );
}

// ------------------------------------------------------------------ doors & signs

const plaqueCache = new Map<string, THREE.CanvasTexture>();
function plaque(text: string) {
  let t = plaqueCache.get(text);
  if (!t) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 96;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#b9b29a";
    ctx.fillRect(0, 0, 256, 96);
    ctx.strokeStyle = "#3a3528";
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 248, 88);
    ctx.fillStyle = "#2a261c";
    ctx.font = "600 56px 'Cormorant Garamond', Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 52);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    plaqueCache.set(text, t);
  }
  return t;
}

export function Door({ position, rotY = 0, label, open = 0 }: { position: V3; rotY?: number; label?: string; open?: number }) {
  const mat = useMemo(() => surface("door"), []);
  useEffect(() => () => releaseSurface(mat), [mat]);
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {/* frame */}
      <mesh position={[0, 2.25, 0]} material={M.darkWood}>
        <boxGeometry args={[1.24, 0.1, 0.16]} />
      </mesh>
      <mesh position={[-0.58, 1.1, 0]} material={M.darkWood}>
        <boxGeometry args={[0.08, 2.2, 0.16]} />
      </mesh>
      <mesh position={[0.58, 1.1, 0]} material={M.darkWood}>
        <boxGeometry args={[0.08, 2.2, 0.16]} />
      </mesh>
      {/* leaf, hinged at -x */}
      <group position={[-0.52, 0, 0]} rotation={[0, open, 0]}>
        <mesh position={[0.52, 1.1, 0]} material={mat} castShadow receiveShadow>
          <boxGeometry args={[1.04, 2.18, 0.05]} />
        </mesh>
        <mesh position={[0.92, 1.05, 0.05]} material={M.metal}>
          <boxGeometry args={[0.04, 0.16, 0.04]} />
        </mesh>
      </group>
      {label && (
        <mesh position={[0, 2.48, 0.03]}>
          <planeGeometry args={[0.5, 0.19]} />
          <meshStandardMaterial map={plaque(label)} roughness={0.7} />
        </mesh>
      )}
    </group>
  );
}

export function ElevatorDoors({ position, rotY = 0, floorLabel }: { position: V3; rotY?: number; floorLabel: string }) {
  const lamp = useRef<THREE.MeshStandardMaterial>(null!);
  useFrame(({ clock }) => {
    lamp.current.emissiveIntensity = 1.2 + Math.sin(clock.elapsedTime * 2) * 0.3;
  });
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 1.2, -0.05]} material={M.darkMetal}>
        <boxGeometry args={[2.6, 2.6, 0.12]} />
      </mesh>
      <mesh position={[-0.5, 1.1, 0.03]} material={M.metal} castShadow>
        <boxGeometry args={[0.98, 2.2, 0.05]} />
      </mesh>
      <mesh position={[0.5, 1.1, 0.03]} material={M.metal} castShadow>
        <boxGeometry args={[0.98, 2.2, 0.05]} />
      </mesh>
      <mesh position={[0, 2.62, 0.04]}>
        <planeGeometry args={[0.5, 0.22]} />
        <meshStandardMaterial ref={lamp} color="#1a0400" emissive="#ff6a1a" emissiveIntensity={1.2} map={plaque(floorLabel)} />
      </mesh>
      <mesh position={[1.12, 1.15, 0.04]} material={M.darkMetal}>
        <boxGeometry args={[0.14, 0.32, 0.04]} />
      </mesh>
      <mesh position={[1.12, 1.2, 0.07]} material={M.redGlow}>
        <sphereGeometry args={[0.025, 8, 8]} />
      </mesh>
    </group>
  );
}

function Decal({ position, rotation, size, map, opacity = 1 }: { position: V3; rotation: V3; size: [number, number]; map: THREE.Texture; opacity?: number }) {
  return (
    <mesh position={position} rotation={rotation} renderOrder={1}>
      <planeGeometry args={size} />
      <meshStandardMaterial map={map} transparent opacity={opacity} depthWrite={false} polygonOffset polygonOffsetFactor={-2} roughness={0.4} />
    </mesh>
  );
}

function CRT({ position, rotY = 0, scale = 1, screen }: { position: V3; rotY?: number; scale?: number; screen: THREE.Texture }) {
  return (
    <group position={position} rotation={[0, rotY, 0]} scale={scale}>
      <mesh material={M.plastic} castShadow receiveShadow>
        <boxGeometry args={[0.5, 0.42, 0.45]} />
      </mesh>
      <mesh position={[0, 0, -0.32]} material={M.plastic} castShadow>
        <boxGeometry args={[0.34, 0.3, 0.25]} />
      </mesh>
      <mesh position={[0, 0.01, 0.226]}>
        <planeGeometry args={[0.4, 0.31]} />
        <meshStandardMaterial map={screen} emissiveMap={screen} emissive="#ffffff" emissiveIntensity={1.1} roughness={0.15} />
      </mesh>
    </group>
  );
}

export function ScreenTicker() {
  const acc = useRef(0);
  useFrame(({ clock }, dt) => {
    acc.current += dt;
    if (acc.current < 1 / 15) return;
    acc.current = 0;
    const s = getScreens();
    s.static.update(clock.elapsedTime);
    s.terminal.update(clock.elapsedTime);
  });
  return null;
}

function FogWindow({ position, rotY = 0, w = 1.6, h = 2.2 }: { position: V3; rotY?: number; w?: number; h?: number }) {
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh material={M.glassFog}>
        <planeGeometry args={[w, h]} />
      </mesh>
      {[-w / 2, 0, w / 2].map((x) => (
        <mesh key={x} position={[x, 0, 0.02]} material={M.darkMetal}>
          <boxGeometry args={[0.06, h, 0.05]} />
        </mesh>
      ))}
      {[-h / 2, 0, h / 2].map((y) => (
        <mesh key={y} position={[0, y, 0.02]} material={M.darkMetal}>
          <boxGeometry args={[w, 0.06, 0.05]} />
        </mesh>
      ))}
    </group>
  );
}

function Gurney({ position, rotY = 0 }: { position: V3; rotY?: number }) {
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.82, 0]} material={M.mattress} castShadow receiveShadow>
        <boxGeometry args={[1.9, 0.12, 0.7]} />
      </mesh>
      <mesh position={[0.3, 0.885, 0.05]} rotation={[-Math.PI / 2, 0, 0.3]}>
        <planeGeometry args={[0.9, 0.5]} />
        <meshStandardMaterial map={baseTexture("blood")} transparent depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.72, 0]} material={M.metal}>
        <boxGeometry args={[1.95, 0.05, 0.72]} />
      </mesh>
      {[-0.85, 0.85].flatMap((x) =>
        [-0.3, 0.3].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.36, z]} material={M.metal} castShadow>
            <cylinderGeometry args={[0.02, 0.02, 0.72, 6]} />
          </mesh>
        )),
      )}
    </group>
  );
}

function Wheelchair({ position, rotY = 0 }: { position: V3; rotY?: number }) {
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.5, 0]} material={M.stainedCloth} castShadow>
        <boxGeometry args={[0.5, 0.06, 0.45]} />
      </mesh>
      <mesh position={[0, 0.78, -0.22]} rotation={[-0.15, 0, 0]} material={M.stainedCloth} castShadow>
        <boxGeometry args={[0.5, 0.5, 0.05]} />
      </mesh>
      {[-0.3, 0.3].map((x) => (
        <mesh key={x} position={[x, 0.32, -0.05]} rotation={[0, Math.PI / 2, 0]} material={M.metal} castShadow>
          <torusGeometry args={[0.3, 0.02, 6, 24]} />
        </mesh>
      ))}
    </group>
  );
}

// ------------------------------------------------------------------ 1F

export function Lobby() {
  const screens = getScreens();
  const saveMat = useRef<THREE.MeshStandardMaterial>(null!);
  const memoMat = useRef<THREE.MeshStandardMaterial>(null!);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    saveMat.current.emissiveIntensity = 1.4 + Math.sin(t * 1.6) * 0.6;
    memoMat.current.emissiveIntensity = 0.12 + Math.max(0, Math.sin(t * 2.4)) * 0.25;
  });

  return (
    <group>
      {/* reception counter */}
      <group position={[0, 0, -4]}>
        <mesh position={[0, 0.55, 0]} material={M.laminate} castShadow receiveShadow>
          <boxGeometry args={[8.4, 1.1, 1.2]} />
        </mesh>
        <mesh position={[0, 1.13, 0.05]} material={M.darkWood} castShadow receiveShadow>
          <boxGeometry args={[8.6, 0.06, 1.35]} />
        </mesh>
        <mesh position={[0, 0.06, 0.61]} material={M.darkWood}>
          <boxGeometry args={[8.4, 0.12, 0.02]} />
        </mesh>
        <CRT position={[2.4, 1.37, -0.1]} rotY={Math.PI} screen={screens.static.texture} scale={0.9} />
        <CRT position={[3.3, 1.37, 0]} rotY={Math.PI + 0.3} screen={screens.static.texture} scale={0.8} />
        {/* scattered files */}
        {[
          [-1.4, 0.2, 0.3],
          [-0.9, -0.1, -0.5],
          [1.2, 0.25, 1.1],
          [0.6, -0.2, 0.2],
        ].map(([x, z, r], i) => (
          <mesh key={i} position={[x, 1.165, z]} rotation={[-Math.PI / 2, 0, r]} material={M.paper}>
            <planeGeometry args={[0.3, 0.4]} />
          </mesh>
        ))}
        {/* the cassette recorder */}
        <group position={[-3.1, 1.16, 0.05]}>
          <mesh position={[0, 0.13, 0]} material={M.blackPlastic} castShadow>
            <boxGeometry args={[0.6, 0.26, 0.18]} />
          </mesh>
          <mesh position={[0, 0.3, 0]} material={M.darkMetal}>
            <torusGeometry args={[0.18, 0.012, 6, 16, Math.PI]} />
          </mesh>
          {[-0.19, 0.19].map((x) => (
            <mesh key={x} position={[x, 0.13, 0.092]} rotation={[Math.PI / 2, 0, 0]} material={M.darkMetal}>
              <cylinderGeometry args={[0.075, 0.075, 0.01, 18]} />
            </mesh>
          ))}
          <mesh position={[0, 0.15, 0.092]} material={M.glassFog}>
            <boxGeometry args={[0.16, 0.09, 0.005]} />
          </mesh>
          <TapeLed />
        </group>
      </group>

      {/* wall of CRT monitors behind the desk */}
      <group position={[0, 0, -7.55]}>
        <mesh position={[0, 1.9, -0.15]} material={M.darkWood} castShadow receiveShadow>
          <boxGeometry args={[6.4, 3.4, 0.5]} />
        </mesh>
        {[0, 1, 2].flatMap((row) =>
          [-2, -1, 0, 1, 2].map((col) => (
            <CRT
              key={`${row}${col}`}
              position={[col * 1.15 + Math.sin(row * 7 + col * 3) * 0.03, 0.75 + row * 1.0, 0.22]}
              rotY={Math.sin(row * 5 + col * 11) * 0.05}
              scale={1.55}
              screen={screens.static.texture}
            />
          )),
        )}
      </group>
      <ThreatGlobe position={[0, 2.3, -4]} />

      {/* pillars */}
      {[
        [-6, 3],
        [6, 3],
        [-6, -3],
        [6, -3],
      ].map(([x, z]) => (
        <Pillar key={`${x}${z}`} x={x} z={z} />
      ))}

      {/* benches + memo */}
      <group position={[-9.5, 0, 1.5]}>
        <mesh position={[0, 0.45, 0]} material={M.wood} castShadow receiveShadow>
          <boxGeometry args={[0.6, 0.08, 3]} />
        </mesh>
        <mesh position={[-0.27, 0.8, 0]} material={M.wood} castShadow>
          <boxGeometry args={[0.06, 0.6, 3]} />
        </mesh>
        {[-1.3, 1.3].map((z) => (
          <mesh key={z} position={[0, 0.22, z]} material={M.darkMetal}>
            <boxGeometry args={[0.5, 0.44, 0.06]} />
          </mesh>
        ))}
        <mesh position={[0.05, 0.495, 0]} rotation={[-Math.PI / 2, 0, 0.25]}>
          <planeGeometry args={[0.24, 0.32]} />
          <meshStandardMaterial ref={memoMat} color="#d8d0b8" emissive="#fff3c8" emissiveIntensity={0.2} roughness={1} />
        </mesh>
      </group>

      {/* save point: the red square */}
      <mesh position={[-9.88, 1.5, -5]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[0.55, 0.55]} />
        <meshStandardMaterial ref={saveMat} color="#300" emissive="#ff1208" emissiveIntensity={1.6} transparent opacity={0.92} />
      </mesh>
      <pointLight position={[-9.3, 1.5, -5]} color="#ff2010" intensity={1.4} distance={3} decay={2} />

      {/* entrance + windows full of fog */}
      <group position={[0, 0, 7.88]} rotation={[0, Math.PI, 0]}>
        <FogWindow position={[-0.6, 1.25, 0]} w={1.15} h={2.4} />
        <FogWindow position={[0.6, 1.25, 0]} w={1.15} h={2.4} />
        <FogWindow position={[-5, 2.3, 0]} w={2.4} h={2.2} />
        <FogWindow position={[5, 2.3, 0]} w={2.4} h={2.2} />
        <mesh position={[0, 2.85, 0.03]}>
          <planeGeometry args={[0.6, 0.2]} />
          <meshStandardMaterial color="#021" emissive="#22ff66" emissiveIntensity={1.2} map={plaque("EXIT")} />
        </mesh>
      </group>
      <Spot position={[0, 3.6, 9.5]} target={[0, 0, 3]} angle={0.9} penumbra={1} intensity={30} distance={14} color="#9fa8ab" />

      <ElevatorDoors position={[9.88, 0, 0]} rotY={-Math.PI / 2} floorLabel="1F" />
      <Gurney position={[7.45, 0, 6.1]} rotY={0.1} />
      <WaitingChairs position={[3.4, 0, 2.0]} rotY={Math.PI} count={4} />
      <WaitingChairs position={[3.4, 0, 3.8]} rotY={Math.PI} count={4} missing={2} />
      <DeadPlant position={[-9.3, 0, 6.8]} />
      <DeadPlant position={[9.3, 0, 6.8]} />
      <DeadPlant position={[-6.8, 0, -3.6]} />
      <NoticeBoard position={[-9.88, 1.6, -1.5]} rotY={Math.PI / 2} />
      <WallClock position={[5.2, 3.4, -7.88]} />
      <FireCabinet position={[-3, 1.1, 7.86]} rotY={Math.PI} />
      <HangingSign position={[0, 0, -1.6]} text="RECEPTION" height={5} />
      <HangingSign position={[7, 0, -0.2]} rotY={-Math.PI / 2} text="ELEVATORS  →" height={5} />
      <Decal position={[7.5, 0.012, 0.8]} rotation={[-Math.PI / 2, 0, -0.6]} size={[2.6, 2.6]} map={baseTexture("blood")} opacity={0.85} />
      <Decal position={[-3, 0.012, 2.5]} rotation={[-Math.PI / 2, 0, 2.1]} size={[1.6, 1.6]} map={baseTexture("blood")} opacity={0.5} />
      <Decal position={[-9.88, 2.9, 3]} rotation={[0, Math.PI / 2, 0]} size={[4, 1]} map={writingTexture("THE FOG REMEMBERS")} opacity={0.9} />

      <Fluorescent position={[0, 4.95, -1.8]} flicker="subtle" intensity={7} />
      <Fluorescent position={[-6, 4.95, 0]} flicker="broken" intensity={7} />
      <Fluorescent position={[6, 4.95, 2]} flicker="subtle" intensity={6} />
    </group>
  );
}

function Pillar({ x, z }: { x: number; z: number }) {
  const mat = useMemo(() => surface("wall", 0.35, 1), []);
  useEffect(() => () => releaseSurface(mat), [mat]);
  return (
    <mesh position={[x, 2.5, z]} material={mat} castShadow receiveShadow>
      <boxGeometry args={[0.7, 5, 0.7]} />
    </mesh>
  );
}

function TapeLed() {
  const mat = useRef<THREE.MeshStandardMaterial>(null!);
  useFrame(({ clock }) => {
    const playing = useGame.getState().tapePlaying;
    mat.current.emissiveIntensity = playing ? 2 + Math.sin(clock.elapsedTime * 8) : 0.1;
  });
  return (
    <mesh position={[0.24, 0.23, 0.092]}>
      <sphereGeometry args={[0.012, 8, 8]} />
      <meshStandardMaterial ref={mat} color="#300" emissive="#ff2010" />
    </mesh>
  );
}

// ------------------------------------------------------------------ 2F

export function Ward() {
  const screens = getScreens();
  const crtLight = useRef<THREE.PointLight>(null!);
  useFrame(({ clock }) => {
    crtLight.current.intensity = 2.2 + Math.sin(clock.elapsedTime * 30) * 0.15 + (Math.random() < 0.02 ? -1 : 0);
  });

  return (
    <group>
      {/* corridor doors */}
      <Door position={[1.69, 0, -4]} rotY={-Math.PI / 2} label="202" />
      <Door position={[-1.69, 0, -12]} rotY={Math.PI / 2} label="203" />
      <Door position={[1.69, 0, -12]} rotY={-Math.PI / 2} label="204" />
      <Door position={[-1.69, 0, -20]} rotY={Math.PI / 2} label="205" />
      <Door position={[1.69, 0, -20]} rotY={-Math.PI / 2} label="206" />
      <Door position={[0, 0, -23.89]} label="STAIRS" />
      {/* 201: door swung open into the room */}
      <Door position={[-1.69, 0, -4]} rotY={Math.PI / 2} label="201" open={1.9} />
      <ElevatorDoors position={[0, 0, 3.89]} rotY={Math.PI} floorLabel="2F" />

      <Wheelchair position={[1.3, 0, -9.1]} rotY={-0.7} />
      {/* handrails, broken at every door */}
      {[
        [3.6, -3.3],
        [-4.7, -11.3],
        [-12.7, -19.3],
        [-20.7, -23.6],
      ].map(([a, b]) => (
        <Handrail key={`w${a}`} position={[-1.69, 0, a]} rotY={Math.PI / 2} length={a - b} />
      ))}
      {[
        [-23.6, -20.7],
        [-19.3, -12.7],
        [-11.3, -4.7],
        [-3.3, 3.6],
      ].map(([a, b]) => (
        <Handrail key={`e${a}`} position={[1.69, 0, a]} rotY={-Math.PI / 2} length={b - a} />
      ))}
      <HangingSign position={[0, 0, -0.6]} text="WARD 2  ·  ROOMS 201 – 206" height={3.6} />
      <WallClock position={[1.68, 2.35, -7]} rotY={-Math.PI / 2} />
      <NoticeBoard position={[-1.68, 1.5, -8]} rotY={Math.PI / 2} />
      <FireCabinet position={[1.62, 1.1, -16]} rotY={-Math.PI / 2} />
      <IVStand position={[-1.15, 0, -17.6]} tilt={0.05} />
      <LinenCart position={[-1.3, 0, -6.8]} rotY={Math.PI / 2} />
      <BrokenCeiling position={[0, 0, -11]} height={3.6} />
      <Gurney position={[1.15, 0, -14.2]} rotY={Math.PI / 2 + 0.05} />
      <Decal position={[0, 0.012, -15]} rotation={[-Math.PI / 2, 0, 1.4]} size={[3, 2.2]} map={baseTexture("blood")} opacity={0.7} />
      <Decal position={[1.68, 1.9, -15.5]} rotation={[0, -Math.PI / 2, 0]} size={[3.4, 0.85]} map={writingTexture("DON'T LOOK BACK")} opacity={0.85} />

      <Fluorescent position={[0, 3.55, 0]} flicker="subtle" intensity={5} length={1.1} />
      <Fluorescent position={[0, 3.55, -8]} flicker="broken" intensity={5} length={1.1} />
      <Fluorescent position={[0, 3.55, -16]} flicker="subtle" intensity={4} length={1.1} />

      {/* room 201 */}
      <group>
        {/* desk with the terminal */}
        <mesh position={[-8.3, 0.76, -4]} material={M.wood} castShadow receiveShadow>
          <boxGeometry args={[1.3, 0.06, 2.2]} />
        </mesh>
        {[-0.95, 0.95].map((z) => (
          <mesh key={z} position={[-8.3, 0.37, -4 + z]} material={M.darkWood} castShadow>
            <boxGeometry args={[1.2, 0.74, 0.06]} />
          </mesh>
        ))}
        <CRT position={[-8.4, 1.05, -4]} rotY={Math.PI / 2} screen={screens.terminal.texture} scale={1.05} />
        <mesh position={[-8.0, 0.8, -4]} material={M.plastic}>
          <boxGeometry args={[0.2, 0.03, 0.55]} />
        </mesh>
        <pointLight ref={crtLight} position={[-7.9, 1.15, -4]} color="#4dff8a" intensity={2.2} distance={4} decay={2} />
        {/* desk lamp */}
        <group position={[-8.6, 0.79, -4.85]}>
          <mesh material={M.darkMetal}>
            <cylinderGeometry args={[0.08, 0.1, 0.03, 12]} />
          </mesh>
          <mesh position={[0.05, 0.22, 0]} rotation={[0, 0, -0.3]} material={M.darkMetal}>
            <cylinderGeometry args={[0.01, 0.01, 0.45, 6]} />
          </mesh>
          <pointLight position={[0.15, 0.38, 0]} color="#ffb766" intensity={1.6} distance={3.5} decay={2} />
        </group>
        {/* chair */}
        <group position={[-7.4, 0, -3.7]} rotation={[0, -1.2, 0]}>
          <mesh position={[0, 0.46, 0]} material={M.darkWood} castShadow>
            <boxGeometry args={[0.45, 0.05, 0.45]} />
          </mesh>
          <mesh position={[0, 0.75, -0.21]} material={M.darkWood} castShadow>
            <boxGeometry args={[0.45, 0.55, 0.04]} />
          </mesh>
        </group>

        <HospitalBed position={[-5.2, 0, -8.35]} />
        <BedsideCabinet position={[-6.6, 0, -8.6]} />
        <IVStand position={[-6.55, 0, -7.55]} />
        <SinkMirror position={[-7.6, 0, 0.9]} rotY={Math.PI} />
        <Wardrobe position={[-8.5, 0, -8.5]} rotY={Math.PI / 2} />
        {/* the diary on the bedside cabinet */}
        <mesh position={[-6.55, 0.81, -8.55]} rotation={[-Math.PI / 2, 0, 0.4]} material={M.paper}>
          <planeGeometry args={[0.2, 0.26]} />
        </mesh>
        {/* privacy curtain */}
        <mesh position={[-4, 1.4, -6.9]} material={M.curtain} castShadow>
          <planeGeometry args={[2.6, 2.4, 12, 1]} />
        </mesh>
        <mesh position={[-4, 2.62, -6.9]} rotation={[0, 0, Math.PI / 2]} material={M.metal}>
          <cylinderGeometry args={[0.015, 0.015, 2.8, 6]} />
        </mesh>
        {/* boarded window */}
        <group position={[-5.4, 1.8, 0.88]} rotation={[0, Math.PI, 0]}>
          <FogWindow position={[0, 0, 0]} w={1.8} h={1.4} />
          {[-0.4, 0.05, 0.45].map((y, i) => (
            <mesh key={y} position={[0, y, 0.06]} rotation={[0, 0, (i - 1) * 0.12]} material={M.wood} castShadow>
              <boxGeometry args={[2.1, 0.18, 0.04]} />
            </mesh>
          ))}
        </group>
        <Spot position={[-5.4, 2.4, 2.5]} target={[-5.4, 0, -2]} angle={0.7} penumbra={1} intensity={10} distance={9} color="#a5adb0" />
        <Decal position={[-8.88, 2.0, -6.4]} rotation={[0, Math.PI / 2, 0]} size={[3.4, 0.85]} map={writingTexture("THEY KNOW YOUR IP")} opacity={0.9} />
        <Fluorescent position={[-5.4, 3.55, -4]} flicker="broken" intensity={3.2} length={1.1} />
      </group>
    </group>
  );
}

export { CRT, Decal };
