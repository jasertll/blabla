"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { audio } from "../audio";
import { M } from "../materials";
import { runtime } from "../store";
import { baseTexture, tex } from "../textures";
import { Character, type Pose } from "./Character";
import { Dust } from "./Atmosphere";
import { FogShadows } from "./Monsters";

export const INTRO_SECONDS = 14;
const START_Z = 13;
const END_Z = -14.5;

const look = new THREE.Vector3();
const camPos = new THREE.Vector3();

function Tree({ position, seed }: { position: [number, number, number]; seed: number }) {
  const branches = useMemo(() => {
    let s = seed;
    const r = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    return Array.from({ length: 9 }, () => ({
      y: 2 + r() * 3.5,
      rot: [r() * 1.2 - 0.6, r() * Math.PI * 2, 0.6 + r() * 0.7] as [number, number, number],
      len: 1 + r() * 2.2,
    }));
  }, [seed]);
  return (
    <group position={position}>
      <mesh position={[0, 2.8, 0]} material={M.darkWood} castShadow>
        <cylinderGeometry args={[0.1, 0.22, 5.6, 7]} />
      </mesh>
      {branches.map((b, i) => (
        <group key={i} position={[0, b.y, 0]} rotation={b.rot}>
          <mesh position={[0, b.len / 2, 0]} material={M.darkWood}>
            <cylinderGeometry args={[0.02, 0.06, b.len, 5]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Lamp({ position, lit }: { position: [number, number, number]; lit?: boolean }) {
  return (
    <group position={position}>
      <mesh position={[0, 2.5, 0]} material={M.darkMetal} castShadow>
        <cylinderGeometry args={[0.06, 0.09, 5, 8]} />
      </mesh>
      <mesh position={[0.45, 4.95, 0]} rotation={[0, 0, Math.PI / 2]} material={M.darkMetal}>
        <cylinderGeometry args={[0.04, 0.04, 0.9, 6]} />
      </mesh>
      <mesh position={[0.85, 4.85, 0]} material={lit ? M.tube : M.tubeOff}>
        <boxGeometry args={[0.35, 0.12, 0.2]} />
      </mesh>
      {lit && <pointLight position={[0.85, 4.5, 0]} intensity={14} distance={12} decay={1.8} color="#e6d9b8" />}
    </group>
  );
}

export function IntroScene({ onDone }: { onDone: () => void }) {
  const camera = useThree((s) => s.camera);
  const char = useRef<THREE.Group>(null!);
  const pose = useRef<Pose>({ phase: 0, amount: 1 });
  const t0 = useRef<number | null>(null);
  const done = useRef(false);
  const lastStep = useRef(0);

  const asphalt = useMemo(() => tex("asphalt", 4, 16), []);
  const sidewalk = useMemo(() => tex("tiles", 2, 30), []);
  const facade = useMemo(() => tex("facade", 1, 1), []);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    if (t0.current === null) t0.current = clock.elapsedTime;
    const t = clock.elapsedTime - t0.current;
    const k = Math.min(1, t / (INTRO_SECONDS - 1));
    // ease out as he reaches the doors
    const z = START_Z + (END_Z - START_Z) * (1 - Math.pow(1 - k, 1.25));
    const speed = t < INTRO_SECONDS - 1 ? 2 : 0;
    pose.current.phase += dt * speed * 3.1;
    pose.current.amount = speed ? 1 : Math.max(0, pose.current.amount - 0.03);
    const step = Math.floor(pose.current.phase / Math.PI);
    if (step !== lastStep.current && speed) {
      lastStep.current = step;
      audio.footstep("asphalt", false);
    }
    char.current.position.set(0, 0, z);
    runtime.pos.set(0, 0, z);
    runtime.yaw = Math.PI;

    if (t < 4.5) {
      // low and behind: a lone figure walking into the fog
      camPos.set(-1.1 + t * 0.12, 0.9 + t * 0.08, z + 4.2 - t * 0.15);
      look.set(0.3, 1.5, z - 6);
    } else if (t < 9) {
      const u = (t - 4.5) / 4.5;
      camPos.set(3.4 - u * 0.8, 0.55 + u * 0.3, z + 0.6 - u * 0.4);
      look.set(0, 1.25, z - 0.4);
    } else {
      const u = Math.min(1, (t - 9) / 4);
      camPos.set(0.9 - u * 0.4, 1.7 + u * 0.35, z + 3.6 + u * 1.2);
      look.set(0, 1.9 + u * 1.6, -20);
    }
    camera.position.lerp(camPos, t < 0.1 ? 1 : 1 - Math.exp(-dt * 5));
    camera.lookAt(look);

    if (t > INTRO_SECONDS && !done.current) {
      done.current = true;
      onDone();
    }
  });

  return (
    <group>
      <directionalLight position={[-10, 30, 10]} intensity={0.35} color="#d8dcd8" />
      {/* street */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[8, 90]} />
        <meshStandardMaterial map={asphalt} roughness={0.95} />
      </mesh>
      {[-5.5, 5.5].map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.08, 0]} receiveShadow>
          <planeGeometry args={[3, 90]} />
          <meshStandardMaterial map={sidewalk} roughness={0.9} color="#9a9a94" />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#3d3f3a" roughness={1} />
      </mesh>

      {/* Brookhaven */}
      <group position={[0, 0, -22]}>
        <mesh position={[0, 7, 0]} castShadow receiveShadow>
          <boxGeometry args={[36, 14, 9]} />
          <meshStandardMaterial map={facade} roughness={0.9} />
        </mesh>
        <mesh position={[0, 6.2, 4.55]}>
          <planeGeometry args={[9, 1.4]} />
          <meshStandardMaterial map={baseTexture("sign")} roughness={0.8} />
        </mesh>
        {/* entrance canopy and doors */}
        <mesh position={[0, 3.6, 6]} material={M.darkMetal} castShadow>
          <boxGeometry args={[6, 0.25, 3]} />
        </mesh>
        {[-2.8, 2.8].map((x) => (
          <mesh key={x} position={[x, 1.8, 7.3]} material={M.darkMetal}>
            <cylinderGeometry args={[0.08, 0.08, 3.6, 8]} />
          </mesh>
        ))}
        <mesh position={[0, 1.4, 4.52]}>
          <planeGeometry args={[2.6, 2.8]} />
          <meshStandardMaterial color="#1a1612" emissive="#4a3b22" emissiveIntensity={0.6} />
        </mesh>
        <pointLight position={[0, 2.5, 6]} intensity={6} distance={8} color="#e8cf98" />
      </group>

      {/* fence with a gate gap */}
      {Array.from({ length: 60 }, (_, i) => -18 + i * 0.6)
        .filter((x) => Math.abs(x) > 2.4)
        .map((x) => (
          <mesh key={x} position={[x, 0.9, -11]} material={M.rustMetal}>
            <boxGeometry args={[0.05, 1.8, 0.05]} />
          </mesh>
        ))}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 10.2, 1.7, -11]} material={M.rustMetal}>
          <boxGeometry args={[15.6, 0.06, 0.06]} />
        </mesh>
      ))}

      <Lamp position={[-4.6, 0, 6]} lit />
      <Lamp position={[4.6, 0, -4]} />
      <Lamp position={[-4.6, 0, -10]} lit />
      <Lamp position={[4.6, 0, 18]} />
      <Tree position={[-8, 0, 2]} seed={3} />
      <Tree position={[9, 0, 8]} seed={7} />
      <Tree position={[-9.5, 0, -6]} seed={11} />
      <Tree position={[8.5, 0, -8]} seed={19} />

      {/* a rusted car abandoned at the kerb */}
      <group position={[3.2, 0, 4]} rotation={[0, 0.08, 0]}>
        <mesh position={[0, 0.65, 0]} material={M.rustMetal} castShadow>
          <boxGeometry args={[1.8, 0.7, 4.2]} />
        </mesh>
        <mesh position={[0, 1.2, -0.3]} material={M.darkMetal} castShadow>
          <boxGeometry args={[1.6, 0.5, 2]} />
        </mesh>
      </group>

      <group ref={char} rotation={[0, Math.PI, 0]}>
        <Character pose={pose} flashlight={false} />
      </group>
      <FogShadows count={4} areas={[{ min: [-12, -10], max: [12, 20] }]} minDist={9} maxDist={20} />
      <Dust count={1800} exterior />
    </group>
  );
}
