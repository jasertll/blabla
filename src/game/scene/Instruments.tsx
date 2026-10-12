"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { ObjectKind } from "../floors";
import type { V3 } from "../level";
import { M } from "../materials";
import { runtime } from "../store";
import { baseTexture } from "../textures";

// The objects the tools live in. Each faces +z with its back to a wall at z=0,
// standing on the floor; the ward renderer rotates them into place.

const chrome = new THREE.MeshStandardMaterial({ color: "#9a9e9b", roughness: 0.3, metalness: 0.9 });
const steel = new THREE.MeshStandardMaterial({ color: "#7d8280", roughness: 0.35, metalness: 0.85 });
const greenCab = new THREE.MeshStandardMaterial({ color: "#4a5648", roughness: 0.6, metalness: 0.4 });
const cork = new THREE.MeshStandardMaterial({ color: "#7a5a3a", roughness: 1 });
const string = new THREE.MeshBasicMaterial({ color: "#a3150c" });
const glass = new THREE.MeshStandardMaterial({ color: "#a9b8a6", roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.32 });
const formalin = new THREE.MeshStandardMaterial({ color: "#8e9a4a", roughness: 0.2, transparent: true, opacity: 0.55, emissive: "#2a2e10", emissiveIntensity: 0.5 });
const flesh = new THREE.MeshStandardMaterial({ color: "#6b3b33", roughness: 0.6 });
const sheet = new THREE.MeshStandardMaterial({ color: "#bdb8a8", roughness: 0.95 });
const brass = new THREE.MeshStandardMaterial({ color: "#7d6436", roughness: 0.4, metalness: 0.8 });
const darkRed = new THREE.MeshStandardMaterial({ color: "#2a0604", emissive: "#a01208", emissiveIntensity: 0.7 });

const paperCache = new Map<string, THREE.CanvasTexture>();
/** A sheet of paper with typewritten lines, a photo square or a chart. */
function paper(kind: "typed" | "photo" | "chart" | "anatomy" | "ticker", seed = 1) {
  const key = `${kind}:${seed}`;
  let t = paperCache.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = kind === "anatomy" ? 512 : 320;
  const ctx = c.getContext("2d")!;
  let s = seed * 9301;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  ctx.fillStyle = kind === "photo" ? "#2a2a26" : "#cdc5ac";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#2a251b";
  if (kind === "typed" || kind === "chart") {
    ctx.font = "bold 22px 'Special Elite', monospace";
    ctx.fillText(kind === "chart" ? "PATIENT CHART" : "BROOKHAVEN", 18, 34);
    for (let y = 60; y < c.height - 20; y += 16) {
      const w = 60 + rnd() * 170;
      ctx.fillRect(18, y, w, 4);
    }
    if (kind === "chart") {
      ctx.strokeStyle = "#8a1a10";
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = 18; x < 238; x += 10) ctx.lineTo(x, 230 + Math.sin(x * 0.2) * 20 + rnd() * 18);
      ctx.stroke();
    }
  } else if (kind === "photo") {
    ctx.fillStyle = "#d8d3c2";
    ctx.fillRect(14, 14, 228, 230);
    ctx.fillStyle = "#3d3b35";
    ctx.fillRect(24, 24, 208, 200);
    // a silhouette
    ctx.fillStyle = "#151412";
    ctx.beginPath();
    ctx.arc(128, 96, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(86, 124, 84, 100);
    if (seed % 3 === 0) {
      ctx.fillStyle = "#8a1a10";
      ctx.fillRect(80, 86, 96, 10);
    }
  } else if (kind === "anatomy") {
    ctx.strokeStyle = "#3a2a1c";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(128, 70, 34, 0, Math.PI * 2);
    ctx.moveTo(128, 104);
    ctx.lineTo(128, 300);
    ctx.moveTo(60, 150);
    ctx.lineTo(196, 150);
    ctx.moveTo(128, 300);
    ctx.lineTo(80, 470);
    ctx.moveTo(128, 300);
    ctx.lineTo(176, 470);
    ctx.stroke();
    ctx.fillStyle = "#7a1a10";
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      ctx.arc(70 + rnd() * 116, 120 + rnd() * 320, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = "16px 'Special Elite', monospace";
    ctx.fillStyle = "#2a251b";
    ctx.fillText("T1059  T1566  T1078", 20, 500);
  } else {
    ctx.font = "18px 'VT323', monospace";
    for (let y = 24; y < c.height; y += 22) ctx.fillText(`XAU ${(1900 + rnd() * 600).toFixed(2)}  ${rnd() > 0.5 ? "▲" : "▼"}`, 14, y);
  }
  // grime
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(60,40,20,${rnd() * 0.15})`;
    ctx.fillRect(rnd() * c.width, rnd() * c.height, 4 + rnd() * 18, 2 + rnd() * 10);
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  paperCache.set(key, t);
  return t;
}

function Sheet({ position, rotation = [0, 0, 0], size = [0.21, 0.28], kind = "typed", seed = 1 }: { position: V3; rotation?: V3; size?: [number, number]; kind?: Parameters<typeof paper>[0]; seed?: number }) {
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={size} />
      <meshStandardMaterial map={paper(kind, seed)} roughness={1} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Table({ w = 1.6, d = 0.8, h = 0.78, mat = M.wood }: { w?: number; d?: number; h?: number; mat?: THREE.Material }) {
  return (
    <group>
      <mesh position={[0, h, 0]} material={mat} castShadow receiveShadow>
        <boxGeometry args={[w, 0.05, d]} />
      </mesh>
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[(x * (w - 0.08)) / 2, h / 2, (z * (d - 0.08)) / 2]} material={M.darkMetal} castShadow>
          <boxGeometry args={[0.04, h, 0.04]} />
        </mesh>
      ))}
    </group>
  );
}

function Lamp({ position, color = "#ffb86b", intensity = 2.2, distance = 4.5 }: { position: V3; color?: string; intensity?: number; distance?: number }) {
  const l = useRef<THREE.PointLight>(null!);
  useFrame(({ clock }) => {
    l.current.intensity = intensity * (1 - runtime.dread * 0.5) * (0.94 + Math.sin(clock.elapsedTime * 37) * 0.03 + (Math.random() < 0.01 ? -0.5 : 0));
  });
  return <pointLight ref={l} position={position} color={color} intensity={intensity} distance={distance} decay={2} />;
}

// ------------------------------------------------------------------ instruments

function Cabinets() {
  return (
    <group>
      {[-1.05, -0.35, 0.35, 1.05].map((x, i) => (
        <group key={x} position={[x, 0, 0.35]}>
          <mesh position={[0, 0.7, 0]} material={greenCab} castShadow receiveShadow>
            <boxGeometry args={[0.66, 1.4, 0.65]} />
          </mesh>
          {[0.25, 0.6, 0.95, 1.3].map((y, k) => (
            <group key={y} position={[0, y - 0.12, 0.33 + (i === 1 && k === 2 ? 0.35 : 0)]}>
              <mesh material={greenCab}>
                <boxGeometry args={[0.6, 0.3, 0.03]} />
              </mesh>
              <mesh position={[0, 0.05, 0.03]} material={brass}>
                <boxGeometry args={[0.16, 0.03, 0.02]} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
      {/* the drawer pulled out, files spilling */}
      {[0, 1, 2, 3, 4].map((k) => (
        <Sheet key={k} position={[-0.4 + k * 0.18, 0.012 + k * 0.002, 1.3 + (k % 2) * 0.2]} rotation={[-Math.PI / 2, 0, k * 0.7]} seed={k + 3} />
      ))}
      <Lamp position={[0, 2.2, 1.2]} color="#c8d2c0" intensity={1.6} />
    </group>
  );
}

function Evidence() {
  const pins: V3[] = [
    [-0.8, 1.9, 0.06],
    [0.1, 2.05, 0.06],
    [0.85, 1.75, 0.06],
    [-0.35, 1.35, 0.06],
    [0.55, 1.2, 0.06],
  ];
  return (
    <group>
      <mesh position={[0, 1.6, 0.03]} material={cork} receiveShadow>
        <boxGeometry args={[2.4, 1.3, 0.04]} />
      </mesh>
      {pins.map((p, i) => (
        <Sheet key={i} position={[p[0], p[1] - 0.05, 0.055]} rotation={[0, 0, (i - 2) * 0.08]} size={[0.26, 0.32]} kind={i % 2 ? "photo" : "typed"} seed={i * 3} />
      ))}
      <StringLines pts={pins} z={0.07} />
      <group position={[0, 0, 0.7]}>
        <Table w={1.4} d={0.7} />
        <Sheet position={[-0.2, 0.81, 0]} rotation={[-Math.PI / 2, 0, 0.2]} kind="photo" seed={9} />
        <Sheet position={[0.25, 0.81, 0.05]} rotation={[-Math.PI / 2, 0, -0.3]} seed={10} />
      </group>
      <Lamp position={[0, 2.4, 1.0]} />
    </group>
  );
}

function StringLines({ pts, z }: { pts: V3[]; z: number }) {
  const segs = useMemo(() => {
    const out: { pos: V3; len: number; rot: number }[] = [];
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        if ((i + j) % 2) continue;
        const a = pts[i];
        const b = pts[j];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        out.push({ pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z], len: Math.hypot(dx, dy), rot: Math.atan2(dy, dx) });
      }
    return out;
  }, [pts, z]);
  return (
    <group>
      {segs.map((s, i) => (
        <mesh key={i} position={s.pos} rotation={[0, 0, s.rot]} material={string}>
          <boxGeometry args={[s.len, 0.008, 0.004]} />
        </mesh>
      ))}
      {pts.map((p, i) => (
        <mesh key={`p${i}`} position={[p[0], p[1], z + 0.01]} material={darkRed}>
          <sphereGeometry args={[0.018, 8, 8]} />
        </mesh>
      ))}
    </group>
  );
}

function ChartBed() {
  return (
    <group position={[0, 0, 1.2]}>
      {/* stripped bed frame */}
      <mesh position={[0, 0.55, 0]} material={M.mattress} castShadow receiveShadow>
        <boxGeometry args={[2.0, 0.16, 0.95]} />
      </mesh>
      <mesh position={[0, 0.45, 0]} material={chrome}>
        <boxGeometry args={[2.05, 0.04, 1.0]} />
      </mesh>
      {[-0.95, 0.95].map((x) =>
        [-0.45, 0.45].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.22, z]} material={chrome}>
            <cylinderGeometry args={[0.02, 0.02, 0.45, 6]} />
          </mesh>
        )),
      )}
      {/* restraints */}
      {[-0.5, 0.3].map((x) => (
        <mesh key={x} position={[x, 0.64, 0]} material={M.darkWood}>
          <boxGeometry args={[0.07, 0.02, 1.0]} />
        </mesh>
      ))}
      {/* the clipboard hanging from the footboard */}
      <mesh position={[1.08, 0.75, 0]} material={M.darkWood}>
        <boxGeometry args={[0.02, 0.36, 0.26]} />
      </mesh>
      <Sheet position={[1.095, 0.74, 0]} rotation={[0, Math.PI / 2, 0]} size={[0.22, 0.3]} kind="chart" seed={4} />
      <Lamp position={[0, 2.3, 0]} color="#cfd8cc" intensity={1.8} />
    </group>
  );
}

function Corkboard() {
  const pins: V3[] = [];
  for (let i = 0; i < 9; i++) pins.push([-1.3 + (i % 3) * 1.3 + Math.sin(i) * 0.2, 1.2 + Math.floor(i / 3) * 0.45 + Math.cos(i) * 0.08, 0.06]);
  return (
    <group>
      <mesh position={[0, 1.65, 0.03]} material={cork} receiveShadow>
        <boxGeometry args={[3.2, 1.6, 0.04]} />
      </mesh>
      {pins.map((p, i) => (
        <Sheet key={i} position={[p[0], p[1] - 0.07, 0.055]} rotation={[0, 0, Math.sin(i * 3) * 0.12]} size={[0.22, 0.27]} kind={i % 3 === 0 ? "photo" : "typed"} seed={i + 20} />
      ))}
      <StringLines pts={pins} z={0.075} />
      <Lamp position={[0, 2.6, 1.2]} intensity={2.4} />
    </group>
  );
}

function Ticker() {
  const tape = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => {
    const m = tape.current.material as THREE.MeshStandardMaterial;
    if (m.map) m.map.offset.y = (clock.elapsedTime * 0.05) % 1;
  });
  const tapeTex = useMemo(() => {
    const t = paper("ticker", 7).clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  }, []);
  return (
    <group position={[0, 0, 0.7]}>
      {/* pedestal */}
      <mesh position={[0, 0.45, 0]} material={M.darkWood} castShadow>
        <cylinderGeometry args={[0.22, 0.3, 0.9, 12]} />
      </mesh>
      {/* glass dome machine */}
      <mesh position={[0, 0.98, 0]} material={brass} castShadow>
        <cylinderGeometry args={[0.2, 0.2, 0.14, 16]} />
      </mesh>
      <mesh position={[0, 1.2, 0]} material={glass}>
        <sphereGeometry args={[0.22, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh position={[0, 1.1, 0]} material={brass}>
        <cylinderGeometry args={[0.05, 0.05, 0.14, 10]} />
      </mesh>
      {/* the tape curling to the floor */}
      <mesh ref={tape} position={[0.15, 0.55, 0.32]} rotation={[-0.5, 0, 0]}>
        <planeGeometry args={[0.05, 1.2]} />
        <meshStandardMaterial map={tapeTex} side={THREE.DoubleSide} roughness={1} />
      </mesh>
      {[0, 1, 2, 3, 4, 5].map((k) => (
        <mesh key={k} position={[0.25 + Math.sin(k) * 0.4, 0.012, 0.6 + Math.cos(k * 1.7) * 0.35]} rotation={[-Math.PI / 2, 0, k]}>
          <planeGeometry args={[0.05, 0.6]} />
          <meshStandardMaterial map={paper("ticker", 7)} roughness={1} />
        </mesh>
      ))}
      <Lamp position={[0, 2.2, 0.3]} intensity={2} />
    </group>
  );
}

function Anatomy() {
  return (
    <group>
      <mesh position={[0, 1.7, 0.03]} material={M.darkWood}>
        <boxGeometry args={[1.25, 2.3, 0.03]} />
      </mesh>
      <Sheet position={[0, 1.7, 0.05]} size={[1.1, 2.15]} kind="anatomy" seed={5} />
      <group position={[0, 0, 0.9]}>
        <Table w={1.3} d={0.6} />
        {[-0.4, -0.1, 0.25].map((x, i) => (
          <mesh key={x} position={[x, 0.82, 0]} rotation={[0, i, Math.PI / 2]} material={chrome}>
            <cylinderGeometry args={[0.006, 0.006, 0.18, 6]} />
          </mesh>
        ))}
      </group>
      <Lamp position={[0, 2.6, 1.1]} color="#e0d6b8" intensity={2.2} />
    </group>
  );
}

function Desk() {
  return (
    <group position={[0, 0, 1.0]}>
      <mesh position={[0, 0.78, 0]} material={M.darkWood} castShadow receiveShadow>
        <boxGeometry args={[2.0, 0.07, 0.95]} />
      </mesh>
      {[-0.75, 0.75].map((x) => (
        <mesh key={x} position={[x, 0.38, 0]} material={M.darkWood} castShadow>
          <boxGeometry args={[0.45, 0.76, 0.9]} />
        </mesh>
      ))}
      <Sheet position={[0.1, 0.82, 0.15]} rotation={[-Math.PI / 2, 0, 0.15]} seed={42} />
      {/* a framed photograph, face down */}
      <mesh position={[-0.6, 0.83, -0.1]} rotation={[-Math.PI / 2, 0, -0.4]} material={M.darkWood}>
        <boxGeometry args={[0.2, 0.26, 0.02]} />
      </mesh>
      {/* green banker's lamp */}
      <group position={[0.7, 0.82, -0.2]}>
        <mesh position={[0, 0.2, 0]} material={brass}>
          <cylinderGeometry args={[0.012, 0.012, 0.4, 6]} />
        </mesh>
        <mesh position={[0, 0.38, 0.05]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.07, 0.07, 0.35, 12, 1, false, 0, Math.PI]} />
          <meshStandardMaterial color="#1f4a2a" emissive="#0e2a14" roughness={0.3} side={THREE.DoubleSide} />
        </mesh>
        <Lamp position={[0, 0.3, 0.1]} color="#ffd08a" intensity={2.8} distance={4} />
      </group>
      {/* chair pushed back */}
      <group position={[0, 0, -0.9]} rotation={[0, 0.4, 0]}>
        <mesh position={[0, 0.5, 0]} material={M.stainedCloth}>
          <boxGeometry args={[0.6, 0.12, 0.6]} />
        </mesh>
        <mesh position={[0, 0.95, -0.28]} material={M.stainedCloth}>
          <boxGeometry args={[0.6, 0.85, 0.12]} />
        </mesh>
      </group>
    </group>
  );
}

function Autopsy() {
  const blood = useMemo(() => new THREE.MeshStandardMaterial({ map: baseTexture("blood"), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), []);
  return (
    <group position={[0, 0, 1.3]}>
      {/* steel table with drain */}
      <mesh position={[0, 0.85, 0]} material={steel} castShadow receiveShadow>
        <boxGeometry args={[2.1, 0.06, 0.8]} />
      </mesh>
      <mesh position={[0, 0.45, 0]} material={steel}>
        <cylinderGeometry args={[0.1, 0.18, 0.8, 10]} />
      </mesh>
      {/* the body under the sheet */}
      <mesh position={[0.05, 0.98, 0]} scale={[1, 0.22, 0.42]} material={sheet} castShadow>
        <capsuleGeometry args={[0.38, 1.1, 6, 12]} />
      </mesh>
      <mesh position={[0.05, 0.98, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.22, 1, 0.42]} material={sheet} castShadow>
        <capsuleGeometry args={[0.38, 1.1, 6, 12]} />
      </mesh>
      {/* a hand slipping out */}
      <mesh position={[-0.2, 0.84, 0.42]} rotation={[0.3, 0, 0.2]} material={flesh}>
        <boxGeometry args={[0.08, 0.2, 0.04]} />
      </mesh>
      {/* toe tag */}
      <mesh position={[0.98, 0.95, 0.1]} rotation={[0, 0.4, 0]} material={M.paper}>
        <planeGeometry args={[0.08, 0.05]} />
      </mesh>
      <mesh position={[0, 0.02, 0.2]} rotation={[-Math.PI / 2, 0, 0.6]} material={blood}>
        <planeGeometry args={[1.6, 1.2]} />
      </mesh>
      {/* surgical lamp */}
      <mesh position={[0, 2.5, 0]} material={M.metal}>
        <cylinderGeometry args={[0.32, 0.4, 0.15, 16]} />
      </mesh>
      <spotLight position={[0, 2.4, 0]} angle={0.55} penumbra={0.7} intensity={14} distance={5} color="#e8eee6" castShadow={false} />
    </group>
  );
}

function Jars() {
  return (
    <group>
      {[0.5, 1.05, 1.6].map((y) => (
        <mesh key={y} position={[0, y, 0.25]} material={M.darkWood} castShadow receiveShadow>
          <boxGeometry args={[2.4, 0.04, 0.45]} />
        </mesh>
      ))}
      {[-1.15, 1.15].map((x) => (
        <mesh key={x} position={[x, 0.9, 0.25]} material={M.darkWood}>
          <boxGeometry args={[0.05, 1.8, 0.45]} />
        </mesh>
      ))}
      {[0.5, 1.05, 1.6].flatMap((y, r) =>
        [-0.85, -0.45, -0.05, 0.4, 0.8].map((x, i) => (
          <group key={`${r}${i}`} position={[x + (r % 2) * 0.1, y + 0.02, 0.25]}>
            <mesh position={[0, 0.17, 0]} material={formalin}>
              <cylinderGeometry args={[0.11, 0.11, 0.32, 14]} />
            </mesh>
            <mesh position={[0, 0.15, 0]} scale={[1, 0.8 + ((i + r) % 3) * 0.2, 1]} material={flesh}>
              <sphereGeometry args={[0.06, 10, 8]} />
            </mesh>
            <mesh position={[0, 0.35, 0]} material={M.darkMetal}>
              <cylinderGeometry args={[0.115, 0.115, 0.03, 14]} />
            </mesh>
          </group>
        )),
      )}
      <Lamp position={[0, 2.2, 1]} color="#c9d49a" intensity={1.8} />
    </group>
  );
}

function Darkroom() {
  return (
    <group>
      {/* clothes line with prints */}
      <mesh position={[0, 2.1, 0.8]} rotation={[0, 0, Math.PI / 2]} material={M.darkMetal}>
        <cylinderGeometry args={[0.004, 0.004, 3, 4]} />
      </mesh>
      {[-1.1, -0.55, 0, 0.55, 1.1].map((x, i) => (
        <Sheet key={x} position={[x, 1.92, 0.8]} size={[0.3, 0.38]} kind="photo" seed={i * 3 + 1} />
      ))}
      {/* trays on a bench */}
      <group position={[0, 0, 0.4]}>
        <Table w={2.2} d={0.7} h={0.9} mat={M.darkMetal} />
        {[-0.65, 0, 0.65].map((x, i) => (
          <mesh key={x} position={[x, 0.94, 0]} material={M.blackPlastic}>
            <boxGeometry args={[0.5, 0.05, 0.4]} />
          </mesh>
        ))}
        <Sheet position={[0.65, 0.97, 0]} rotation={[-Math.PI / 2, 0, 0.1]} size={[0.3, 0.35]} kind="photo" seed={3} />
      </group>
      {/* safelight */}
      <mesh position={[0, 2.5, 0.08]} material={darkRed}>
        <boxGeometry args={[0.3, 0.2, 0.1]} />
      </mesh>
      <pointLight position={[0, 2.3, 0.6]} color="#ff1a08" intensity={3.2} distance={6} decay={1.8} />
    </group>
  );
}

function Tray() {
  return (
    <group position={[0, 0, 0.9]}>
      {/* trolley */}
      <mesh position={[0, 0.9, 0]} material={steel} castShadow>
        <boxGeometry args={[1.0, 0.03, 0.6]} />
      </mesh>
      <mesh position={[0, 0.4, 0]} material={steel}>
        <boxGeometry args={[1.0, 0.03, 0.6]} />
      </mesh>
      {[-1, 1].flatMap((x) =>
        [-1, 1].map((z) => (
          <mesh key={`${x}${z}`} position={[x * 0.47, 0.45, z * 0.27]} material={chrome}>
            <cylinderGeometry args={[0.012, 0.012, 0.9, 6]} />
          </mesh>
        )),
      )}
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[-0.38 + i * 0.095, 0.925, Math.sin(i * 2) * 0.1]} rotation={[0, Math.sin(i) * 0.3, Math.PI / 2]} material={chrome}>
          <cylinderGeometry args={[0.006, 0.004, 0.22 + (i % 3) * 0.05, 6]} />
        </mesh>
      ))}
      <mesh position={[0.3, 0.93, 0.2]} material={formalin}>
        <cylinderGeometry args={[0.05, 0.05, 0.1, 10]} />
      </mesh>
      <Lamp position={[0, 2.2, 0]} color="#d8e2d2" intensity={2} />
    </group>
  );
}

function Ecg() {
  const screen = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 160;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { c, ctx: c.getContext("2d")!, t, x: 0, last: 80 };
  }, []);
  useFrame(({ clock }) => {
    const s = screen;
    const ctx = s.ctx;
    const t = clock.elapsedTime;
    ctx.fillStyle = "rgba(2,10,4,0.18)";
    ctx.fillRect(s.x, 0, 14, 160);
    const beat = (t % 1.1) / 1.1;
    const y = 80 - (beat > 0.1 && beat < 0.14 ? 60 : beat > 0.14 && beat < 0.17 ? -30 : Math.sin(t * 9) * 3);
    ctx.strokeStyle = runtime.dread > 0.5 ? "#ff3a20" : "#5cff8a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x, s.last);
    s.x = (s.x + 3) % 256;
    ctx.lineTo(s.x, y);
    ctx.stroke();
    s.last = y;
    if (s.x < 3) ctx.clearRect(0, 0, 256, 160);
    s.t.needsUpdate = true;
  });
  return (
    <group position={[0, 0, 0.7]}>
      {/* monitor cart */}
      <mesh position={[0, 0.5, 0]} material={M.plastic} castShadow>
        <boxGeometry args={[0.6, 1.0, 0.5]} />
      </mesh>
      <mesh position={[0, 1.25, 0]} material={M.plastic} castShadow>
        <boxGeometry args={[0.62, 0.48, 0.4]} />
      </mesh>
      <mesh position={[0, 1.27, 0.205]}>
        <planeGeometry args={[0.5, 0.32]} />
        <meshBasicMaterial map={screen.t} toneMapped={false} />
      </mesh>
      {/* leads hanging down to an empty pillow */}
      {[-0.1, 0, 0.1].map((x) => (
        <mesh key={x} position={[x, 0.8, 0.3]} rotation={[0.4, 0, 0]} material={M.blackPlastic}>
          <cylinderGeometry args={[0.005, 0.005, 0.9, 4]} />
        </mesh>
      ))}
      <pointLight position={[0, 1.3, 0.6]} color="#5cff8a" intensity={1.4} distance={3} decay={2} />
    </group>
  );
}

function Microscope() {
  return (
    <group position={[0, 0, 0.5]}>
      <Table w={1.8} d={0.75} h={0.9} mat={M.laminate} />
      <group position={[0, 0.93, 0]}>
        <mesh position={[0, 0.02, 0]} material={M.blackPlastic}>
          <boxGeometry args={[0.2, 0.04, 0.26]} />
        </mesh>
        <mesh position={[0, 0.2, -0.08]} rotation={[0.25, 0, 0]} material={M.blackPlastic}>
          <boxGeometry args={[0.06, 0.36, 0.06]} />
        </mesh>
        <mesh position={[0, 0.34, 0.02]} rotation={[-0.6, 0, 0]} material={chrome}>
          <cylinderGeometry args={[0.025, 0.025, 0.2, 10]} />
        </mesh>
        <mesh position={[0, 0.1, 0.04]} material={chrome}>
          <boxGeometry args={[0.14, 0.01, 0.12]} />
        </mesh>
      </group>
      {/* slides */}
      {[0.4, 0.5, 0.6].map((x) => (
        <mesh key={x} position={[x, 0.935, 0.15]} rotation={[-Math.PI / 2, 0, 0.1]} material={glass}>
          <planeGeometry args={[0.07, 0.025]} />
        </mesh>
      ))}
      <Lamp position={[0.3, 1.8, 0.4]} color="#e6efe9" intensity={2.2} />
    </group>
  );
}

function Shelves() {
  const spines = useMemo(() => {
    const out: { x: number; y: number; h: number; c: string; lean: number }[] = [];
    let s = 7;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (const y of [0.1, 0.65, 1.2, 1.75, 2.3])
      for (let x = -1.35; x < 1.35; x += 0.07 + rnd() * 0.04) {
        if (rnd() < 0.12) continue;
        out.push({ x, y, h: 0.32 + rnd() * 0.15, c: ["#3a2a20", "#2a3328", "#4a3a26", "#2a2630", "#5a2a20"][Math.floor(rnd() * 5)], lean: rnd() < 0.1 ? 0.3 : 0 });
      }
    return out;
  }, []);
  return (
    <group>
      {[0.08, 0.63, 1.18, 1.73, 2.28].map((y) => (
        <mesh key={y} position={[0, y, 0.22]} material={M.darkWood} receiveShadow>
          <boxGeometry args={[2.9, 0.04, 0.42]} />
        </mesh>
      ))}
      {[-1.45, 1.45].map((x) => (
        <mesh key={x} position={[x, 1.3, 0.22]} material={M.darkWood}>
          <boxGeometry args={[0.05, 2.6, 0.42]} />
        </mesh>
      ))}
      {spines.map((b, i) => (
        <mesh key={i} position={[b.x, b.y + b.h / 2 + 0.02, 0.24]} rotation={[0, 0, b.lean]}>
          <boxGeometry args={[0.055, b.h, 0.3]} />
          <meshStandardMaterial color={b.c} roughness={0.9} />
        </mesh>
      ))}
      <group position={[0.4, 0, 1.3]}>
        <Table w={1.2} d={0.7} />
        <Sheet position={[0, 0.81, 0]} rotation={[-Math.PI / 2, 0, 0.3]} seed={77} />
        {/* the reel-to-reel */}
        <mesh position={[-0.35, 0.86, -0.1]} material={M.darkMetal}>
          <boxGeometry args={[0.4, 0.12, 0.3]} />
        </mesh>
        {[-0.45, -0.25].map((x) => (
          <mesh key={x} position={[x, 0.93, -0.1]} rotation={[Math.PI / 2, 0, 0]} material={M.metal}>
            <cylinderGeometry args={[0.08, 0.08, 0.015, 16]} />
          </mesh>
        ))}
        <Lamp position={[0, 1.8, 0]} intensity={2} />
      </group>
    </group>
  );
}

function Birdcage() {
  const cage = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    cage.current.rotation.z = Math.sin(clock.elapsedTime * 0.6) * 0.04;
  });
  return (
    <group position={[0, 0, 1.0]}>
      <mesh position={[0, 2.3, 0]} material={M.darkMetal}>
        <cylinderGeometry args={[0.004, 0.004, 0.7, 4]} />
      </mesh>
      <group ref={cage} position={[0, 1.95, 0]}>
        <group position={[0, -0.6, 0]}>
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * 0.22, 0.3, Math.sin(a) * 0.22]} material={brass}>
                <cylinderGeometry args={[0.004, 0.004, 0.6, 4]} />
              </mesh>
            );
          })}
          <mesh position={[0, 0, 0]} material={brass}>
            <cylinderGeometry args={[0.24, 0.24, 0.03, 18]} />
          </mesh>
          <mesh position={[0, 0.6, 0]} material={brass}>
            <sphereGeometry args={[0.23, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
          {/* the canary, dead on the floor of the cage */}
          <mesh position={[0.05, 0.04, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1.5, 1]}>
            <sphereGeometry args={[0.035, 10, 8]} />
            <meshStandardMaterial color="#c9a62a" roughness={0.8} />
          </mesh>
        </group>
      </group>
      <Table w={0.8} d={0.6} h={0.75} />
      <Lamp position={[0, 2.4, 0.6]} color="#ffd38a" intensity={2.2} />
    </group>
  );
}

function Press() {
  const wheel = useRef<THREE.Group>(null!);
  useFrame((_, dt) => {
    wheel.current.rotation.z += dt * 0.15 * (0.2 + runtime.dread);
  });
  return (
    <group position={[0, 0, 0.9]}>
      <mesh position={[0, 0.6, 0]} material={M.darkMetal} castShadow receiveShadow>
        <boxGeometry args={[1.5, 1.2, 0.9]} />
      </mesh>
      <mesh position={[0, 1.25, 0]} material={M.metal} castShadow>
        <boxGeometry args={[1.2, 0.1, 0.8]} />
      </mesh>
      <mesh position={[0, 1.6, 0]} material={M.darkMetal}>
        <cylinderGeometry args={[0.06, 0.06, 0.7, 10]} />
      </mesh>
      <group ref={wheel} position={[0.85, 1.0, 0]}>
        <mesh rotation={[0, Math.PI / 2, 0]} material={M.rustMetal}>
          <torusGeometry args={[0.35, 0.025, 6, 24]} />
        </mesh>
        {[0, 1, 2].map((k) => (
          <mesh key={k} rotation={[(k * Math.PI) / 3, 0, 0]} material={M.rustMetal}>
            <boxGeometry args={[0.02, 0.7, 0.02]} />
          </mesh>
        ))}
      </group>
      {[0, 1, 2, 3].map((k) => (
        <Sheet key={k} position={[-0.2 + k * 0.1, 1.31 + k * 0.002, 0.05]} rotation={[-Math.PI / 2, 0, k * 0.1]} seed={50 + k} />
      ))}
      <Lamp position={[0, 2.4, 0.6]} intensity={2} />
    </group>
  );
}

function Stamp() {
  return (
    <group position={[0, 0, 0.9]}>
      <Table w={1.6} d={0.8} mat={M.darkWood} />
      <mesh position={[0.3, 0.86, 0]} material={brass}>
        <cylinderGeometry args={[0.06, 0.08, 0.12, 12]} />
      </mesh>
      <mesh position={[0.3, 0.98, 0]} material={M.darkWood}>
        <sphereGeometry args={[0.05, 10, 8]} />
      </mesh>
      <mesh position={[-0.2, 0.82, 0.1]} material={darkRed}>
        <boxGeometry args={[0.16, 0.02, 0.1]} />
      </mesh>
      <Sheet position={[-0.3, 0.81, -0.1]} rotation={[-Math.PI / 2, 0, -0.1]} seed={61} />
      <Sheet position={[0.0, 0.812, -0.05]} rotation={[-Math.PI / 2, 0, 0.2]} kind="photo" seed={6} />
      <Lamp position={[0, 1.9, 0.2]} color="#ffcf8a" intensity={2.2} />
    </group>
  );
}

function Enlarger() {
  return (
    <group position={[0, 0, 0.5]}>
      <Table w={1.4} d={0.8} h={0.9} mat={M.darkMetal} />
      <mesh position={[0, 0.93, 0]} material={M.blackPlastic}>
        <boxGeometry args={[0.6, 0.03, 0.5]} />
      </mesh>
      <mesh position={[0, 1.5, -0.25]} material={M.darkMetal}>
        <boxGeometry args={[0.06, 1.2, 0.06]} />
      </mesh>
      <mesh position={[0, 1.75, -0.08]} material={M.darkMetal}>
        <boxGeometry args={[0.24, 0.3, 0.26]} />
      </mesh>
      <mesh position={[0, 1.55, -0.04]} material={M.blackPlastic}>
        <cylinderGeometry args={[0.05, 0.06, 0.12, 12]} />
      </mesh>
      {/* the projected image on the easel */}
      <Sheet position={[0, 0.95, 0]} rotation={[-Math.PI / 2, 0, 0]} size={[0.42, 0.36]} kind="photo" seed={12} />
      <spotLight position={[0, 1.48, -0.04]} angle={0.3} penumbra={0.5} intensity={6} distance={2} color="#ffefd0" />
      <pointLight position={[0.5, 2.1, 0.6]} color="#ff2210" intensity={2} distance={5} />
    </group>
  );
}

const KINDS: Record<ObjectKind, () => React.ReactElement> = {
  cabinets: Cabinets,
  evidence: Evidence,
  "chart-bed": ChartBed,
  corkboard: Corkboard,
  ticker: Ticker,
  anatomy: Anatomy,
  desk: Desk,
  autopsy: Autopsy,
  jars: Jars,
  darkroom: Darkroom,
  tray: Tray,
  ecg: Ecg,
  microscope: Microscope,
  shelves: Shelves,
  birdcage: Birdcage,
  press: Press,
  stamp: Stamp,
  enlarger: Enlarger,
};

export function Instrument({ kind, position, rotY }: { kind: ObjectKind; position: V3; rotY: number }) {
  const K = KINDS[kind];
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <K />
    </group>
  );
}

export { Sheet, Lamp };
