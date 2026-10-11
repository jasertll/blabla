"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { V3 } from "../level";
import { runtime } from "../store";

// Placeholder for the original site's ThreatGlobe, projected as a flickering
// hologram above the reception desk. The real component (CISA KEV + NVD data)
// replaces the particle data when the tools are merged in.

const CLUSTERS = ["#ff3b30", "#9b5cff", "#ff4fa3", "#ff9f1c", "#3cc8ff", "#ffd23f", "#d8d8d8"];
const COUNT = 4200;
const R = 0.82;
const TRAIL = 28;
const TRAIL_STEP = 0.045; // radians between trail points

function randomOnSphere(v: THREE.Vector3) {
  const u = Math.random() * 2 - 1;
  const t = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return v.set(s * Math.cos(t), u, s * Math.sin(t));
}

const pointsMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uFlicker: { value: 1 }, uDread: { value: 0 } },
  vertexShader: /* glsl */ `
    attribute vec3 color;
    attribute float seed;
    uniform float uTime;
    uniform float uDread;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec3 p = position;
      p += normalize(p) * sin(uTime * 2.0 + seed * 40.0) * 0.015;
      p += normalize(p) * uDread * sin(uTime * 9.0 + seed * 70.0) * 0.08;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = (2.2 + seed * 2.5) * (6.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
      vColor = mix(color, vec3(1.0, 0.1, 0.05), uDread * 0.85);
      vAlpha = 0.55 + 0.45 * sin(uTime * 3.0 + seed * 20.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uFlicker;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      float a = smoothstep(0.5, 0.0, d) * vAlpha * uFlicker;
      gl_FragColor = vec4(vColor * 1.6, a);
    }`,
});

interface Comet {
  axis: THREE.Vector3;
  start: THREE.Vector3;
  speed: number;
  phase: number;
  line: THREE.Line;
  positions: Float32Array;
  head: THREE.Mesh;
}

export function ThreatGlobe({ position }: { position: V3 }) {
  const group = useRef<THREE.Group>(null!);
  const wire = useRef<THREE.LineSegments>(null!);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    const col = new Float32Array(COUNT * 3);
    const seed = new Float32Array(COUNT);
    const centers = CLUSTERS.map(() => randomOnSphere(new THREE.Vector3()).clone());
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      const k = i % CLUSTERS.length;
      if (Math.random() < 0.75) {
        v.copy(centers[k])
          .add(new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9))
          .normalize();
      } else randomOnSphere(v);
      v.multiplyScalar(R * (0.96 + Math.random() * 0.08));
      pos.set([v.x, v.y, v.z], i * 3);
      c.set(CLUSTERS[k]);
      col.set([c.r, c.g, c.b], i * 3);
      seed[i] = Math.random();
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
    return g;
  }, []);

  const comets = useMemo<Comet[]>(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const positions = new Float32Array(TRAIL * 3);
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const colors = new Float32Array(TRAIL * 3);
      for (let k = 0; k < TRAIL; k++) {
        const f = Math.pow(1 - k / TRAIL, 1.6);
        colors.set([f, f * 0.55, f * 0.4], k * 3);
      }
      lg.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const line = new THREE.Line(
        lg,
        new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      line.frustumCulled = false;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), new THREE.MeshBasicMaterial({ color: "#ffd8b0" }));
      const axis = randomOnSphere(new THREE.Vector3()).clone();
      // a starting point on the orbit circle perpendicular to `axis`
      const start = new THREE.Vector3(1, 0, 0);
      if (Math.abs(axis.x) > 0.9) start.set(0, 1, 0);
      start.cross(axis).normalize().multiplyScalar(R * (1.15 + Math.random() * 0.35));
      return { axis, start, speed: 0.5 + Math.random() * 0.6, phase: (i / 7) * Math.PI * 2, line, positions, head };
    });
  }, []);

  const p = useMemo(() => new THREE.Vector3(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const u = pointsMaterial.uniforms;
    u.uTime.value = t;
    u.uDread.value = runtime.dread;
    // hologram flicker: mostly stable, occasional dropouts
    u.uFlicker.value = Math.random() < 0.03 ? 0.25 : 0.85 + Math.sin(t * 60) * 0.05;
    group.current.rotation.y = t * 0.12;
    group.current.position.y = position[1] + Math.sin(t * 0.8) * 0.04;
    (wire.current.material as THREE.LineBasicMaterial).opacity = 0.07 + Math.random() * 0.03;

    for (const c of comets) {
      const a = t * c.speed + c.phase;
      // the trail is the orbit itself, sampled just behind the head
      for (let k = 0; k < TRAIL; k++) {
        q.setFromAxisAngle(c.axis, a - k * TRAIL_STEP);
        p.copy(c.start).applyQuaternion(q);
        c.positions[k * 3] = p.x;
        c.positions[k * 3 + 1] = p.y;
        c.positions[k * 3 + 2] = p.z;
        if (k === 0) c.head.position.copy(p);
      }
      c.line.geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <group position={position}>
      <group ref={group}>
        <points geometry={geometry} material={pointsMaterial} />
        <lineSegments ref={wire}>
          <wireframeGeometry args={[new THREE.IcosahedronGeometry(R * 0.98, 3)]} />
          <lineBasicMaterial color="#8fd6ff" transparent opacity={0.08} depthWrite={false} blending={THREE.AdditiveBlending} />
        </lineSegments>
        {comets.map((c, i) => (
          <group key={i}>
            <primitive object={c.line} />
            <primitive object={c.head} />
          </group>
        ))}
      </group>
      {/* projector puck on the counter */}
      <mesh position={[0, 1.19 - position[1], 0]}>
        <cylinderGeometry args={[0.28, 0.32, 0.06, 24]} />
        <meshStandardMaterial color="#1a1c1c" metalness={0.8} roughness={0.35} emissive="#2a6a8a" emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[0, (1.19 - position[1]) / 2, 0]}>
        <cylinderGeometry args={[0.75, 0.26, position[1] - 1.19, 32, 1, true]} />
        <meshBasicMaterial color="#5fb6ff" transparent opacity={0.035} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>
      <pointLight position={[0, 0, 0]} color="#7aa8ff" intensity={2.5} distance={5} decay={2} />
    </group>
  );
}
