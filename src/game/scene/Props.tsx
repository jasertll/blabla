"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { V3 } from "../level";
import { M } from "../materials";
import { baseTexture } from "../textures";

// Hospital furniture. Everything sits on the floor at y=0 in its own group so
// layouts can drop pieces in with a position and a rotation.

const chrome = new THREE.MeshStandardMaterial({ color: "#a7aba8", roughness: 0.28, metalness: 0.9 });
const enamel = new THREE.MeshStandardMaterial({ color: "#c9c7bc", roughness: 0.35 });
const vinylSeat = new THREE.MeshStandardMaterial({ color: "#3e4d4c", roughness: 0.55 });
const sheet = new THREE.MeshStandardMaterial({ color: "#c3bfb0", roughness: 0.95 });
const mirrorMat = new THREE.MeshStandardMaterial({ color: "#7c8584", roughness: 0.05, metalness: 1 });
const cork = new THREE.MeshStandardMaterial({ color: "#6b4f33", roughness: 1 });
const red = new THREE.MeshStandardMaterial({ color: "#7a0f0a", roughness: 0.45 });
const deadLeaf = new THREE.MeshStandardMaterial({ color: "#3b3322", roughness: 1, side: THREE.DoubleSide });
const bloodMat = () => new THREE.MeshStandardMaterial({ map: baseTexture("blood"), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

type P = { position: V3; rotY?: number };

function Leg({ x, z, h, r = 0.018, mat = chrome }: { x: number; z: number; h: number; r?: number; mat?: THREE.Material }) {
  return (
    <mesh position={[x, h / 2, z]} material={mat} castShadow>
      <cylinderGeometry args={[r, r, h, 8]} />
    </mesh>
  );
}

/** Adjustable ward bed with side rails, stained sheets and a raised backrest. */
export function HospitalBed({ position, rotY = 0, bloody = true }: P & { bloody?: boolean }) {
  const blood = useMemo(bloodMat, []);
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {/* frame + castors */}
      <mesh position={[0, 0.48, 0]} material={chrome} castShadow receiveShadow>
        <boxGeometry args={[2.05, 0.06, 0.92]} />
      </mesh>
      {[-0.95, 0.95].flatMap((x) =>
        [-0.4, 0.4].map((z) => (
          <group key={`${x}${z}`}>
            <Leg x={x} z={z} h={0.46} />
            <mesh position={[x, 0.05, z]} rotation={[Math.PI / 2, 0, 0]} material={M.blackPlastic}>
              <cylinderGeometry args={[0.05, 0.05, 0.03, 10]} />
            </mesh>
          </group>
        )),
      )}
      {/* mattress, flat section + raised back */}
      <mesh position={[0.3, 0.59, 0]} material={M.mattress} castShadow receiveShadow>
        <boxGeometry args={[1.4, 0.16, 0.86]} />
      </mesh>
      <mesh position={[-0.68, 0.72, 0]} rotation={[0, 0, -0.45]} material={M.mattress} castShadow receiveShadow>
        <boxGeometry args={[0.7, 0.16, 0.86]} />
      </mesh>
      {/* crumpled sheet and pillow */}
      <mesh position={[0.45, 0.68, 0.03]} rotation={[0, 0.06, 0.02]} scale={[1, 0.35, 1]} material={sheet} castShadow>
        <sphereGeometry args={[0.6, 14, 8]} />
      </mesh>
      <mesh position={[-0.82, 0.86, 0]} rotation={[0, 0, -0.45]} scale={[0.6, 0.22, 1]} material={sheet} castShadow>
        <sphereGeometry args={[0.3, 12, 8]} />
      </mesh>
      {bloody && (
        <mesh position={[0.15, 0.692, 0.1]} rotation={[-Math.PI / 2, 0, 0.7]} material={blood}>
          <planeGeometry args={[0.9, 0.7]} />
        </mesh>
      )}
      {/* head + foot boards */}
      <mesh position={[-1.03, 0.82, 0]} material={enamel} castShadow>
        <boxGeometry args={[0.04, 0.68, 0.92]} />
      </mesh>
      <mesh position={[1.03, 0.7, 0]} material={enamel} castShadow>
        <boxGeometry args={[0.04, 0.44, 0.92]} />
      </mesh>
      {/* side rails: one up, one dropped */}
      {[0.47, -0.47].map((z, i) => (
        <group key={z} position={[0, i === 0 ? 0.82 : 0.6, z]}>
          {[0, 0.12].map((y) => (
            <mesh key={y} position={[0, y, 0]} rotation={[0, 0, Math.PI / 2]} material={chrome}>
              <cylinderGeometry args={[0.012, 0.012, 1.3, 6]} />
            </mesh>
          ))}
          {[-0.6, -0.2, 0.2, 0.6].map((x) => (
            <mesh key={x} position={[x, 0.06, 0]} material={chrome}>
              <cylinderGeometry args={[0.01, 0.01, 0.12, 6]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Drip stand with a half-empty bag and a dangling line. */
export function IVStand({ position, rotY = 0, tilt = 0 }: P & { tilt?: number }) {
  return (
    <group position={position} rotation={[tilt, rotY, 0]}>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[Math.cos((i / 5) * Math.PI * 2) * 0.16, 0.03, Math.sin((i / 5) * Math.PI * 2) * 0.16]} rotation={[0, -(i / 5) * Math.PI * 2, Math.PI / 2]} material={chrome}>
          <cylinderGeometry args={[0.012, 0.012, 0.32, 6]} />
        </mesh>
      ))}
      <mesh position={[0, 0.95, 0]} material={chrome} castShadow>
        <cylinderGeometry args={[0.012, 0.012, 1.9, 6]} />
      </mesh>
      <mesh position={[0, 1.88, 0]} rotation={[0, 0, Math.PI / 2]} material={chrome}>
        <cylinderGeometry args={[0.008, 0.008, 0.36, 6]} />
      </mesh>
      <mesh position={[0.14, 1.72, 0]} scale={[1, 1.6, 0.4]} castShadow>
        <sphereGeometry args={[0.07, 10, 8]} />
        <meshStandardMaterial color="#6f6a58" transparent opacity={0.5} roughness={0.55} />
      </mesh>
      <mesh position={[0.15, 1.15, 0.02]} rotation={[0, 0, 0.05]}>
        <cylinderGeometry args={[0.003, 0.003, 1, 4]} />
        <meshStandardMaterial color="#d8d4c6" transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

export function BedsideCabinet({ position, rotY = 0 }: P) {
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.4, 0]} material={enamel} castShadow receiveShadow>
        <boxGeometry args={[0.45, 0.8, 0.45]} />
      </mesh>
      <mesh position={[0, 0.62, 0.226]} material={M.darkMetal}>
        <boxGeometry args={[0.38, 0.14, 0.01]} />
      </mesh>
      <mesh position={[0, 0.62, 0.235]} material={chrome}>
        <boxGeometry args={[0.12, 0.02, 0.02]} />
      </mesh>
      {/* a glass and a pill bottle */}
      <mesh position={[-0.1, 0.86, 0.05]}>
        <cylinderGeometry args={[0.035, 0.03, 0.11, 12]} />
        <meshStandardMaterial color="#cfd6d2" transparent opacity={0.35} roughness={0.05} />
      </mesh>
      <mesh position={[0.08, 0.85, -0.05]} material={M.rustMetal}>
        <cylinderGeometry args={[0.025, 0.025, 0.09, 10]} />
      </mesh>
    </group>
  );
}

/** Wall-hung sink with a cracked mirror above it. Back against the wall at z=0. */
export function SinkMirror({ position, rotY = 0 }: P) {
  const crack = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      ctx.moveTo(150, 90);
      let x = 150;
      let y = 90;
      const a = (i / 14) * Math.PI * 2;
      for (let k = 0; k < 6; k++) {
        x += Math.cos(a + (Math.random() - 0.5)) * 22;
        y += Math.sin(a + (Math.random() - 0.5)) * 22;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    return t;
  }, []);
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.82, 0.22]} material={enamel} castShadow receiveShadow>
        <boxGeometry args={[0.55, 0.16, 0.42]} />
      </mesh>
      <mesh position={[0, 0.9, 0.22]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.17, 20]} />
        <meshStandardMaterial color="#5e5a4c" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.98, 0.06]} material={chrome}>
        <cylinderGeometry args={[0.012, 0.012, 0.16, 8]} />
      </mesh>
      <mesh position={[0, 1.05, 0.12]} rotation={[Math.PI / 2, 0, 0]} material={chrome}>
        <cylinderGeometry args={[0.01, 0.01, 0.12, 8]} />
      </mesh>
      <mesh position={[0, 0.45, 0.08]} material={chrome}>
        <cylinderGeometry args={[0.03, 0.03, 0.6, 8]} />
      </mesh>
      {/* mirror */}
      <mesh position={[0, 1.5, 0.02]} material={M.darkMetal}>
        <boxGeometry args={[0.52, 0.68, 0.03]} />
      </mesh>
      <mesh position={[0, 1.5, 0.036]} material={mirrorMat}>
        <planeGeometry args={[0.46, 0.62]} />
      </mesh>
      <mesh position={[0, 1.5, 0.038]}>
        <planeGeometry args={[0.46, 0.62]} />
        <meshBasicMaterial map={crack} transparent opacity={0.6} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Row of linked plastic waiting-room chairs on a steel beam. */
export function WaitingChairs({ position, rotY = 0, count = 4, missing = -1 }: P & { count?: number; missing?: number }) {
  const w = 0.56;
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.36, 0]} rotation={[0, 0, Math.PI / 2]} material={M.darkMetal}>
        <boxGeometry args={[0.05, count * w, 0.06]} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s} position={[(s * (count * w)) / 2.2, 0, 0]}>
          <Leg x={0} z={0.18} h={0.36} r={0.02} mat={M.darkMetal} />
          <Leg x={0} z={-0.18} h={0.36} r={0.02} mat={M.darkMetal} />
        </group>
      ))}
      {Array.from({ length: count }, (_, i) =>
        i === missing ? null : (
          <group key={i} position={[(i - (count - 1) / 2) * w, 0, 0]} rotation={[0, 0, (i % 3 === 1 ? 0.03 : 0)]}>
            <mesh position={[0, 0.44, 0.02]} rotation={[-0.08, 0, 0]} material={vinylSeat} castShadow receiveShadow>
              <boxGeometry args={[0.48, 0.05, 0.44]} />
            </mesh>
            <mesh position={[0, 0.72, -0.2]} rotation={[-0.12, 0, 0]} material={vinylSeat} castShadow>
              <boxGeometry args={[0.48, 0.48, 0.04]} />
            </mesh>
          </group>
        ),
      )}
    </group>
  );
}

/** Steel handrail on wall brackets, running along +x from the origin. */
export function Handrail({ position, rotY = 0, length }: P & { length: number }) {
  const n = Math.max(2, Math.round(length / 1.4) + 1);
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[length / 2, 0.92, 0.07]} rotation={[0, 0, Math.PI / 2]} material={M.metal} castShadow>
        <cylinderGeometry args={[0.022, 0.022, length, 8]} />
      </mesh>
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} position={[(i * length) / (n - 1), 0.92, 0.035]} rotation={[Math.PI / 2, 0, 0]} material={M.metal}>
          <cylinderGeometry args={[0.012, 0.012, 0.07, 6]} />
        </mesh>
      ))}
    </group>
  );
}

/** A sign hung from the ceiling on two chains. */
export function HangingSign({ position, rotY = 0, text, height }: P & { text: string; height: number }) {
  const map = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 192;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#1d2a26";
    ctx.fillRect(0, 0, 1024, 192);
    ctx.strokeStyle = "#a9b0a2";
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, 1004, 172);
    ctx.fillStyle = "#d9d6c8";
    ctx.font = "600 84px 'Cormorant Garamond', Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 512, 100);
    // grime
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(20,16,10,${Math.random() * 0.25})`;
      ctx.fillRect(Math.random() * 1024, Math.random() * 192, 3 + Math.random() * 10, 2 + Math.random() * 6);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [text]);
  const y = height - 0.75;
  return (
    <group position={[position[0], 0, position[2]]} rotation={[0, rotY, 0.02]}>
      {[-0.7, 0.7].map((x) => (
        <mesh key={x} position={[x, (height + y + 0.13) / 2, 0]} material={M.darkMetal}>
          <cylinderGeometry args={[0.006, 0.006, height - y - 0.13, 4]} />
        </mesh>
      ))}
      <mesh position={[0, y, 0]} castShadow>
        <boxGeometry args={[1.7, 0.32, 0.03]} />
        <meshStandardMaterial map={map} roughness={0.7} />
      </mesh>
    </group>
  );
}

/** Wall clock, hands stopped. Faces +z, back against the wall. */
export function WallClock({ position, rotY = 0 }: P) {
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={M.darkMetal}>
        <cylinderGeometry args={[0.2, 0.2, 0.05, 28]} />
      </mesh>
      <mesh position={[0, 0, 0.027]}>
        <circleGeometry args={[0.18, 28]} />
        <meshStandardMaterial color="#d6d0bd" roughness={0.6} />
      </mesh>
      {/* 4:17 */}
      <mesh position={[0.045, -0.02, 0.03]} rotation={[0, 0, -2.2]} material={M.blackPlastic}>
        <boxGeometry args={[0.012, 0.1, 0.005]} />
      </mesh>
      <mesh position={[0.03, -0.065, 0.032]} rotation={[0, 0, -2.75]} material={red}>
        <boxGeometry args={[0.008, 0.15, 0.005]} />
      </mesh>
    </group>
  );
}

/** Cork notice board with curling papers. Faces +z. */
export function NoticeBoard({ position, rotY = 0 }: P) {
  const papers = useMemo(
    () =>
      Array.from({ length: 9 }, (_, i) => ({
        x: -0.62 + (i % 4) * 0.4 + (Math.random() - 0.5) * 0.1,
        y: 0.25 - Math.floor(i / 4) * 0.3 + (Math.random() - 0.5) * 0.06,
        r: (Math.random() - 0.5) * 0.25,
        w: 0.22 + Math.random() * 0.1,
      })),
    [],
  );
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh material={M.darkWood}>
        <boxGeometry args={[1.7, 0.95, 0.04]} />
      </mesh>
      <mesh position={[0, 0, 0.022]} material={cork}>
        <planeGeometry args={[1.6, 0.85]} />
      </mesh>
      {papers.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, 0.026 + i * 0.001]} rotation={[0, 0, p.r]} material={M.paper}>
          <planeGeometry args={[p.w, p.w * 1.3]} />
        </mesh>
      ))}
    </group>
  );
}

export function DeadPlant({ position }: P) {
  const leaves = useMemo(() => Array.from({ length: 7 }, (_, i) => ({ a: (i / 7) * Math.PI * 2, t: 0.6 + Math.random() * 0.7, h: 0.5 + Math.random() * 0.4 })), []);
  return (
    <group position={position}>
      <mesh position={[0, 0.22, 0]} material={M.rustMetal} castShadow>
        <cylinderGeometry args={[0.2, 0.15, 0.44, 14]} />
      </mesh>
      {leaves.map((l, i) => (
        <mesh key={i} position={[Math.cos(l.a) * 0.12, 0.44 + l.h / 2, Math.sin(l.a) * 0.12]} rotation={[Math.sin(l.a) * l.t, 0, -Math.cos(l.a) * l.t]} material={deadLeaf} castShadow>
          <planeGeometry args={[0.12, l.h]} />
        </mesh>
      ))}
    </group>
  );
}

/** Linen trolley with a canvas bag. */
export function LinenCart({ position, rotY = 0 }: P) {
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {[-0.35, 0.35].flatMap((x) => [-0.22, 0.22].map((z) => <Leg key={`${x}${z}`} x={x} z={z} h={0.9} r={0.012} />))}
      <mesh position={[0, 0.62, 0]} material={M.stainedCloth} castShadow>
        <boxGeometry args={[0.68, 0.55, 0.42]} />
      </mesh>
      <mesh position={[0, 0.92, 0]} material={chrome}>
        <boxGeometry args={[0.74, 0.02, 0.48]} />
      </mesh>
    </group>
  );
}

/** Red fire-extinguisher cabinet. Faces +z. */
export function FireCabinet({ position, rotY = 0 }: P) {
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh material={red}>
        <boxGeometry args={[0.36, 0.7, 0.14]} />
      </mesh>
      <mesh position={[0, 0, 0.072]}>
        <planeGeometry args={[0.28, 0.58]} />
        <meshStandardMaterial color="#9fa8a4" transparent opacity={0.35} roughness={0.05} />
      </mesh>
      <mesh position={[0, -0.05, 0.01]} material={red}>
        <cylinderGeometry args={[0.06, 0.06, 0.44, 12]} />
      </mesh>
    </group>
  );
}

/** Open ceiling with a panel hanging by one corner and exposed pipes. */
export function BrokenCeiling({ position, height }: P & { height: number }) {
  return (
    <group position={[position[0], height, position[2]]}>
      <mesh position={[0, -0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.2, 1.2]} />
        <meshStandardMaterial color="#050505" />
      </mesh>
      <mesh position={[0.35, -0.38, 0.1]} rotation={[0.9, 0.2, 0.4]} castShadow>
        <boxGeometry args={[0.6, 0.02, 0.6]} />
        <meshStandardMaterial color="#8e8c80" roughness={1} />
      </mesh>
      {[-0.3, 0.1].map((x) => (
        <mesh key={x} position={[x, -0.12, 0]} rotation={[Math.PI / 2, 0, 0]} material={M.rustMetal}>
          <cylinderGeometry args={[0.05, 0.05, 1.3, 10]} />
        </mesh>
      ))}
      <mesh position={[-0.15, -0.5, 0.3]} material={M.darkMetal}>
        <cylinderGeometry args={[0.004, 0.004, 1, 4]} />
      </mesh>
    </group>
  );
}

/** Tall steel wardrobe, one door ajar. */
export function Wardrobe({ position, rotY = 0 }: P) {
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.95, 0]} material={M.metal} castShadow receiveShadow>
        <boxGeometry args={[0.8, 1.9, 0.55]} />
      </mesh>
      <mesh position={[0.2, 0.95, 0.29]} rotation={[0, -0.45, 0]} material={M.metal} castShadow>
        <boxGeometry args={[0.4, 1.86, 0.02]} />
      </mesh>
      <mesh position={[-0.2, 0.95, 0.281]} material={M.darkMetal}>
        <boxGeometry args={[0.38, 1.86, 0.01]} />
      </mesh>
    </group>
  );
}

/** Window with bars. Faces +z; light from outside is the fog. */
export function BarredWindow({ position, rotY = 0, w = 1.4, h = 1.3 }: P & { w?: number; h?: number }) {
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh material={M.glassFog}>
        <planeGeometry args={[w, h]} />
      </mesh>
      {Array.from({ length: Math.round(w / 0.14) + 1 }, (_, i) => (
        <mesh key={i} position={[-w / 2 + (i * w) / Math.round(w / 0.14), 0, 0.06]} material={M.rustMetal}>
          <cylinderGeometry args={[0.012, 0.012, h, 6]} />
        </mesh>
      ))}
      <mesh position={[0, -h / 2 - 0.04, 0.06]} material={enamel}>
        <boxGeometry args={[w + 0.2, 0.06, 0.16]} />
      </mesh>
    </group>
  );
}
