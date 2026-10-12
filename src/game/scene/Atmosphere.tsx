"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { audio } from "../audio";
import { setOtherworld } from "../materials";
import { runtime, useGame, type PlayFloor } from "../store";
import { threatDistances } from "./Monsters";

const FOG: Record<PlayFloor, { color: string; density: number }> = {
  EXTERIOR: { color: "#8d8f8b", density: 0.06 },
  "1F": { color: "#262826", density: 0.05 },
  "2F": { color: "#1f211f", density: 0.075 },
  "3F": { color: "#1e201d", density: 0.08 },
  "4F": { color: "#221f1b", density: 0.07 },
  B1: { color: "#121513", density: 0.095 },
  B2: { color: "#141311", density: 0.09 },
  ROOF: { color: "#7d807c", density: 0.075 },
};
const OTHER = { color: "#140605", density: 0.085 };
const NIGHTMARE = { color: "#070202", density: 0.11 };

/** Eases the world between normal and Otherworld, and keeps fog, ambient light
 *  and the soundscape in step with it. */
export function Atmosphere() {
  const scene = useThree((s) => s.scene);
  const floor = useGame((s) => s.floor);
  const muted = useGame((s) => s.muted);
  const hemi = useRef<THREE.HemisphereLight>(null!);
  const fog = useMemo(() => new THREE.FogExp2("#262826", 0.05), []);
  const c1 = useMemo(() => new THREE.Color(), []);
  const c2 = useMemo(() => new THREE.Color(), []);
  const staticAcc = useRef(0);

  useEffect(() => {
    scene.fog = fog;
    scene.background = fog.color;
    return () => {
      scene.fog = null;
    };
  }, [scene, fog]);

  useEffect(() => audio.setMuted(muted), [muted]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const g = useGame.getState();
    const want = g.nightmare || performance.now() < g.otherworldUntil ? 1 : 0;
    runtime.dread += (want - runtime.dread) * (1 - Math.exp(-dt * (want ? 1.1 : 0.5)));
    const on = runtime.dread > 0.5;
    if (on !== g.owActive) {
      setOtherworld(on);
      g.setOw(on);
    }

    const base = FOG[g.floor];
    const dark = g.nightmare ? NIGHTMARE : OTHER;
    c1.set(base.color);
    c2.set(dark.color);
    fog.color.copy(c1).lerp(c2, runtime.dread);
    fog.density = THREE.MathUtils.lerp(base.density, dark.density, runtime.dread);

    hemi.current.intensity = g.floor === "EXTERIOR" || g.floor === "ROOF" ? 1.1 : THREE.MathUtils.lerp(0.32, 0.12, runtime.dread);
    hemi.current.color.set(g.floor === "EXTERIOR" || g.floor === "ROOF" ? "#b9bdb8" : "#6d7570").lerp(c2.set("#ff3018"), runtime.dread * 0.5);

    // the radio
    staticAcc.current += dt;
    if (staticAcc.current > 0.06) {
      staticAcc.current = 0;
      let nearest = 99;
      threatDistances.forEach((d) => (nearest = Math.min(nearest, d)));
      runtime.threat = nearest;
      const level = Math.max(THREE.MathUtils.clamp((11 - nearest) / 9, 0, 1), runtime.dread * 0.12);
      audio.setStatic(g.phase === "play" ? level : 0);
      audio.setDread(runtime.dread);
    }
  });

  return <hemisphereLight ref={hemi} args={["#6d7570", "#16130f", 0.32]} />;
}

// ------------------------------------------------------------------ dust

const dustMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uLightPos: { value: new THREE.Vector3() },
    uLightDir: { value: new THREE.Vector3(0, 0, 1) },
    uCenter: { value: new THREE.Vector3() },
    uTint: { value: new THREE.Color("#fff2d8") },
    uAmbient: { value: 0.05 },
  },
  vertexShader: /* glsl */ `
    attribute float seed;
    uniform float uTime;
    uniform vec3 uCenter;
    uniform vec3 uLightPos;
    uniform vec3 uLightDir;
    varying float vLit;
    void main() {
      // particles live in a box that wraps around the player
      vec3 box = vec3(14.0, 4.5, 14.0);
      vec3 p = position + vec3(sin(uTime * 0.11 + seed * 9.0), sin(uTime * 0.07 + seed * 5.0) * 0.6 - uTime * 0.03, cos(uTime * 0.09 + seed * 7.0)) * 0.8;
      p = mod(p - uCenter + box * 0.5, box) - box * 0.5 + uCenter;
      vec3 toP = p - uLightPos;
      float dist = length(toP);
      float cone = smoothstep(0.82, 0.95, dot(toP / max(dist, 1e-3), uLightDir));
      vLit = cone * (1.0 - smoothstep(1.0, 9.0, dist));
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = (1.0 + seed * 2.0) * (5.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uTint;
    uniform float uAmbient;
    varying float vLit;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      float a = smoothstep(0.5, 0.0, d) * (uAmbient + vLit * 0.9);
      gl_FragColor = vec4(uTint * a, a);
    }`,
});

export function Dust({ count = 2600, exterior = false }: { count?: number; exterior?: boolean }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos.set([(Math.random() - 0.5) * 14, Math.random() * 4.5, (Math.random() - 0.5) * 14], i * 3);
      seed[i] = Math.random();
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
    return g;
  }, [count]);

  useFrame(({ clock }) => {
    const u = dustMaterial.uniforms;
    u.uTime.value = clock.elapsedTime;
    u.uCenter.value.set(runtime.pos.x, 2.25, runtime.pos.z);
    u.uLightPos.value.set(runtime.pos.x + Math.sin(runtime.yaw) * 0.16, 1.39, runtime.pos.z + Math.cos(runtime.yaw) * 0.16);
    u.uLightDir.value.set(Math.sin(runtime.yaw), -0.12, Math.cos(runtime.yaw)).normalize();
    u.uAmbient.value = exterior ? 0.35 : 0.05;
    (u.uTint.value as THREE.Color).set(runtime.dread > 0.5 ? "#ffb0a0" : exterior ? "#c9cbc6" : "#fff2d8");
  });

  return <points geometry={geometry} material={dustMaterial} frustumCulled={false} />;
}
