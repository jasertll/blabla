"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";

export interface Pose {
  /** Gait phase in radians. */
  phase: number;
  /** 0 idle, 1 walk, ~1.6 run. */
  amount: number;
}

const jacket = new THREE.MeshStandardMaterial({ color: "#4a5233", roughness: 0.88 });
const jacketDark = new THREE.MeshStandardMaterial({ color: "#363c25", roughness: 0.9 });
const shirt = new THREE.MeshStandardMaterial({ color: "#5d6266", roughness: 0.9 });
const jeans = new THREE.MeshStandardMaterial({ color: "#2f3542", roughness: 0.85 });
const skin = new THREE.MeshStandardMaterial({ color: "#b48d77", roughness: 0.6 });
const hair = new THREE.MeshStandardMaterial({ color: "#2a2119", roughness: 0.8 });
const boots = new THREE.MeshStandardMaterial({ color: "#1d1712", roughness: 0.6 });
const steel = new THREE.MeshStandardMaterial({ color: "#3b3d3c", roughness: 0.35, metalness: 0.85 });
const eye = new THREE.MeshStandardMaterial({ color: "#151110", roughness: 0.2 });
const stubble = new THREE.MeshStandardMaterial({ color: "#8a6a58", roughness: 0.9 });
const lens = new THREE.MeshStandardMaterial({ color: "#fff", emissive: "#fff6dc", emissiveIntensity: 3 });

const beamMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  uniforms: { uStrength: { value: 0.16 } },
  vertexShader: /* glsl */ `
    varying float vY;
    varying vec3 vN;
    varying vec3 vView;
    void main() {
      vY = uv.y;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uStrength;
    varying float vY;
    varying vec3 vN;
    varying vec3 vView;
    void main() {
      float rim = pow(abs(dot(vN, vView)), 2.0);
      float a = pow(vY, 2.2) * rim * uStrength;
      gl_FragColor = vec4(vec3(1.0, 0.96, 0.86) * a, a);
    }`,
});

function Limb({ len, radius, mat, children }: { len: number; radius: number; mat: THREE.Material; children?: React.ReactNode }) {
  return (
    <>
      <mesh position={[0, -len / 2, 0]} material={mat} castShadow>
        <capsuleGeometry args={[radius, Math.max(0.01, len - radius * 2), 4, 10]} />
      </mesh>
      {children}
    </>
  );
}

export function Character({ pose, flashlight = true, shadowSize = 1024 }: { pose: RefObject<Pose>; flashlight?: boolean; shadowSize?: number }) {
  const root = useRef<THREE.Group>(null!);
  const torso = useRef<THREE.Group>(null!);
  const thighL = useRef<THREE.Group>(null!);
  const thighR = useRef<THREE.Group>(null!);
  const shinL = useRef<THREE.Group>(null!);
  const shinR = useRef<THREE.Group>(null!);
  const armL = useRef<THREE.Group>(null!);
  const armR = useRef<THREE.Group>(null!);
  const foreL = useRef<THREE.Group>(null!);
  const foreR = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const spot = useRef<THREE.SpotLight>(null!);

  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(0.08, 0.7, 5);
    return o;
  }, []);

  useFrame(({ clock }) => {
    const { phase: p, amount: a } = pose.current;
    const t = clock.elapsedTime;
    const s = Math.sin(p);
    root.current.position.y = Math.abs(Math.cos(p)) * 0.035 * Math.min(a, 1.4);
    thighL.current.rotation.x = s * 0.55 * a;
    thighR.current.rotation.x = -s * 0.55 * a;
    shinL.current.rotation.x = -Math.max(0, Math.sin(p + 1.2)) * 0.95 * a;
    shinR.current.rotation.x = -Math.max(0, Math.sin(p + Math.PI + 1.2)) * 0.95 * a;
    armL.current.rotation.x = -s * 0.42 * a;
    armR.current.rotation.x = s * 0.42 * a;
    foreL.current.rotation.x = -0.2 - 0.35 * Math.min(a, 1.6);
    foreR.current.rotation.x = -0.2 - 0.35 * Math.min(a, 1.6);
    const breath = Math.sin(t * 1.7) * 0.012 * (1 - Math.min(a, 1));
    torso.current.rotation.x = 0.06 + a * 0.06 + breath;
    torso.current.rotation.y = s * 0.07 * a;
    head.current.rotation.x = -0.04 - breath * 2;
    head.current.rotation.y = Math.sin(t * 0.35) * 0.12 * (1 - Math.min(a, 1));
    if (spot.current) {
      // the beam wobbles with each step
      spot.current.intensity = 42 + Math.sin(t * 31) * 0.4;
      target.position.x = 0.08 + Math.sin(p) * 0.08 * a;
      target.position.y = 0.6 + Math.cos(p * 2) * 0.05 * a;
    }
  });

  return (
    <group ref={root}>
      {/* legs */}
      <group ref={thighL} position={[0.1, 0.94, 0]}>
        <Limb len={0.45} radius={0.085} mat={jeans} />
        <group ref={shinL} position={[0, -0.45, 0]}>
          <Limb len={0.43} radius={0.07} mat={jeans} />
          <mesh position={[0, -0.45, 0.05]} material={boots} castShadow>
            <boxGeometry args={[0.12, 0.09, 0.27]} />
          </mesh>
        </group>
      </group>
      <group ref={thighR} position={[-0.1, 0.94, 0]}>
        <Limb len={0.45} radius={0.085} mat={jeans} />
        <group ref={shinR} position={[0, -0.45, 0]}>
          <Limb len={0.43} radius={0.07} mat={jeans} />
          <mesh position={[0, -0.45, 0.05]} material={boots} castShadow>
            <boxGeometry args={[0.12, 0.09, 0.27]} />
          </mesh>
        </group>
      </group>

      <group ref={torso} position={[0, 0.94, 0]}>
        {/* pelvis + jacket */}
        <mesh position={[0, 0.04, 0]} material={jeans} castShadow>
          <boxGeometry args={[0.36, 0.16, 0.22]} />
        </mesh>
        <mesh position={[0, 0.3, 0]} material={jacket} scale={[1.4, 1, 0.82]} castShadow>
          <capsuleGeometry args={[0.165, 0.28, 6, 14]} />
        </mesh>
        {/* jacket hem */}
        <mesh position={[0, 0.07, 0]} material={jacketDark} scale={[1.42, 1, 0.86]} castShadow>
          <cylinderGeometry args={[0.175, 0.18, 0.12, 14]} />
        </mesh>
        {/* zipper line and pockets */}
        <mesh position={[0, 0.3, 0.138]} material={jacketDark}>
          <boxGeometry args={[0.018, 0.5, 0.01]} />
        </mesh>
        <mesh position={[-0.11, 0.43, 0.128]} rotation={[0.08, 0, 0]} material={jacketDark}>
          <boxGeometry args={[0.1, 0.012, 0.02]} />
        </mesh>
        {/* pocket radio */}
        <mesh position={[-0.12, 0.17, 0.13]} material={steel} castShadow>
          <boxGeometry args={[0.09, 0.12, 0.04]} />
        </mesh>
        {/* collar + shirt */}
        <mesh position={[0, 0.55, 0.01]} material={jacket} castShadow>
          <cylinderGeometry args={[0.1, 0.16, 0.08, 12, 1, true]} />
        </mesh>
        <mesh position={[0, 0.53, 0.05]} material={shirt}>
          <boxGeometry args={[0.1, 0.06, 0.06]} />
        </mesh>
        {/* clipped flashlight */}
        <group position={[0.11, 0.45, 0.16]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={steel} castShadow>
            <cylinderGeometry args={[0.026, 0.02, 0.12, 10]} />
          </mesh>
          <mesh position={[0, 0, 0.061]} rotation={[Math.PI / 2, 0, 0]} material={lens}>
            <circleGeometry args={[0.024, 12]} />
          </mesh>
          {flashlight && (
            <>
              <spotLight
                ref={spot}
                position={[0, 0, 0.07]}
                target={target}
                angle={0.48}
                penumbra={0.6}
                distance={26}
                decay={1.45}
                intensity={42}
                color="#fff3da"
                castShadow
                shadow-mapSize-width={shadowSize}
                shadow-mapSize-height={shadowSize}
                shadow-bias={-0.0004}
                shadow-normalBias={0.02}
                shadow-camera-near={0.1}
                shadow-camera-far={26}
              />
              <primitive object={target} />
              {/* visible beam in the dust */}
              <mesh position={[0, 0.24, 2.99]} rotation={[-Math.PI / 2 - 0.08, 0, 0]} material={beamMaterial}>
                <coneGeometry args={[1.55, 6, 24, 1, true]} />
              </mesh>
            </>
          )}
        </group>

        {/* arms */}
        <group ref={armL} position={[0.235, 0.5, 0]} rotation={[0, 0, 0.07]}>
          <Limb len={0.31} radius={0.058} mat={jacket} />
          <group ref={foreL} position={[0, -0.31, 0]}>
            <Limb len={0.28} radius={0.05} mat={jacket} />
            <mesh position={[0, -0.32, 0.01]} scale={[0.8, 1.2, 0.55]} material={skin} castShadow>
              <sphereGeometry args={[0.048, 10, 8]} />
            </mesh>
          </group>
        </group>
        <group ref={armR} position={[-0.235, 0.5, 0]} rotation={[0, 0, -0.07]}>
          <Limb len={0.31} radius={0.058} mat={jacket} />
          <group ref={foreR} position={[0, -0.31, 0]}>
            <Limb len={0.28} radius={0.05} mat={jacket} />
            <mesh position={[0, -0.32, 0.01]} scale={[0.8, 1.2, 0.55]} material={skin} castShadow>
              <sphereGeometry args={[0.048, 10, 8]} />
            </mesh>
          </group>
        </group>

        {/* head */}
        <group ref={head} position={[0, 0.64, 0]}>
          <mesh position={[0, 0, 0]} material={skin} castShadow>
            <cylinderGeometry args={[0.045, 0.05, 0.1, 10]} />
          </mesh>
          <mesh position={[0, 0.12, 0.01]} material={skin} scale={[0.88, 1.1, 1]} castShadow>
            <sphereGeometry args={[0.1, 18, 14]} />
          </mesh>
          <mesh position={[0, 0.155, -0.008]} material={hair} scale={[0.93, 0.85, 1.04]} castShadow>
            <sphereGeometry args={[0.1, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
          </mesh>
          <mesh position={[0, 0.11, 0.098]} material={skin}>
            <boxGeometry args={[0.022, 0.04, 0.03]} />
          </mesh>
          {/* brow, eyes, jaw */}
          <mesh position={[0, 0.148, 0.088]} material={hair}>
            <boxGeometry args={[0.12, 0.012, 0.02]} />
          </mesh>
          {[-0.035, 0.035].map((x) => (
            <mesh key={x} position={[x, 0.128, 0.091]} material={eye}>
              <sphereGeometry args={[0.009, 8, 6]} />
            </mesh>
          ))}
          <mesh position={[0, 0.05, 0.05]} scale={[1, 0.6, 1]} material={stubble}>
            <sphereGeometry args={[0.068, 12, 8]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
