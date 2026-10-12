import * as THREE from "three";
import { normalTex, tex } from "./textures";

// Surfaces register themselves here so the whole hospital can flip to the
// Otherworld in one pass when `runtime.dread` crosses the threshold.

export type SurfaceKind = "wall" | "floor" | "ceiling" | "door" | "roof";

interface Look {
  map: THREE.Texture;
  normal: THREE.Texture;
  color: THREE.Color;
  roughness: number;
  metalness: number;
  bump: number;
}

interface Entry {
  mat: THREE.MeshStandardMaterial;
  normal: Look;
  other: Look;
}

const registry = new Set<Entry>();
let otherworld = false;

// Photographed textures (CC0, from the three.js examples). Loaded once and
// cloned per surface so each can carry its own repeat.
const photoCache = new Map<string, THREE.Texture>();
function photo(url: string, rx: number, ry: number, srgb: boolean) {
  let base = photoCache.get(url);
  if (!base) {
    base = new THREE.TextureLoader().load(url, () => {
      // clones made before the image arrived need re-uploading
      for (const e of registry) {
        const m = e.mat;
        if (m.map?.source === base!.source) m.map.needsUpdate = true;
        if (m.normalMap?.source === base!.source) m.normalMap.needsUpdate = true;
      }
    });
    base.wrapS = base.wrapT = THREE.RepeatWrapping;
    base.anisotropy = 8;
    if (srgb) base.colorSpace = THREE.SRGBColorSpace;
    photoCache.set(url, base);
  }
  const t = base.clone();
  t.repeat.set(rx, ry);
  return t;
}

const looks: Record<SurfaceKind, (rx: number, ry: number) => [Look, Look]> = {
  wall: (rx, ry) => [
    { map: tex("wall", rx, ry), normal: normalTex("wall", rx, ry, 3), color: new THREE.Color(1, 1, 1), roughness: 0.78, metalness: 0, bump: 0.55 },
    { map: tex("rust", rx, ry), normal: normalTex("rust", rx, ry, 8), color: new THREE.Color(0.85, 0.75, 0.72), roughness: 0.62, metalness: 0.35, bump: 1.4 },
  ],
  floor: (rx, ry) => [
    { map: photo("textures/floor_diffuse.jpg", rx * 1.35, ry * 1.35, true), normal: photo("textures/floor_normal.jpg", rx * 1.35, ry * 1.35, false), color: new THREE.Color(0.72, 0.74, 0.7), roughness: 0.38, metalness: 0, bump: 0.9 },
    { map: tex("grate", rx * 2, ry * 2), normal: normalTex("grate", rx * 2, ry * 2, 10), color: new THREE.Color(1, 0.9, 0.85), roughness: 0.5, metalness: 0.55, bump: 1.5 },
  ],
  ceiling: (rx, ry) => [
    { map: tex("ceiling", rx, ry), normal: normalTex("ceiling", rx, ry, 5), color: new THREE.Color(0.9, 0.9, 0.88), roughness: 0.95, metalness: 0, bump: 0.8 },
    { map: tex("rust", rx, ry), normal: normalTex("rust", rx, ry, 8), color: new THREE.Color(0.45, 0.32, 0.3), roughness: 0.7, metalness: 0.3, bump: 1.4 },
  ],
  roof: (rx, ry) => [
    { map: tex("ceiling", rx * 2, ry * 2), normal: normalTex("ceiling", rx * 2, ry * 2, 6), color: new THREE.Color(0.55, 0.56, 0.54), roughness: 0.95, metalness: 0, bump: 1.2 },
    { map: tex("grate", rx * 2, ry * 2), normal: normalTex("grate", rx * 2, ry * 2, 10), color: new THREE.Color(1, 0.9, 0.85), roughness: 0.5, metalness: 0.55, bump: 1.5 },
  ],
  door: () => [
    { map: tex("door"), normal: normalTex("door", 1, 1, 6), color: new THREE.Color(1, 1, 1), roughness: 0.75, metalness: 0.2, bump: 1 },
    { map: tex("doorOW"), normal: normalTex("doorOW", 1, 1, 8), color: new THREE.Color(1, 0.9, 0.9), roughness: 0.55, metalness: 0.5, bump: 1.4 },
  ],
};

function apply(e: Entry, l: Look) {
  e.mat.map = l.map;
  e.mat.normalMap = l.normal;
  e.mat.normalScale.set(l.bump, l.bump);
  e.mat.color.copy(l.color);
  e.mat.roughness = l.roughness;
  e.mat.metalness = l.metalness;
  e.mat.needsUpdate = true;
}

export function surface(kind: SurfaceKind, rx = 1, ry = 1): THREE.MeshStandardMaterial {
  const [normal, other] = looks[kind](rx, ry);
  const mat = new THREE.MeshStandardMaterial();
  const e: Entry = { mat, normal, other };
  apply(e, otherworld ? other : normal);
  registry.add(e);
  return mat;
}

export function releaseSurface(mat: THREE.Material) {
  for (const e of registry) if (e.mat === mat) {
    registry.delete(e);
    mat.dispose();
  }
}

export function setOtherworld(on: boolean) {
  if (on === otherworld) return;
  otherworld = on;
  for (const e of registry) apply(e, on ? e.other : e.normal);
}

export const otherworldApplied = () => otherworld;

// Shared prop materials (not swapped; props are darkened by lighting instead).
export const M = {
  metal: new THREE.MeshStandardMaterial({ color: "#6d6f6c", roughness: 0.45, metalness: 0.8 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: "#2b2d2c", roughness: 0.55, metalness: 0.7 }),
  rustMetal: new THREE.MeshStandardMaterial({ color: "#5a3a26", roughness: 0.8, metalness: 0.5 }),
  wood: new THREE.MeshStandardMaterial({ color: "#4a3626", roughness: 0.8 }),
  darkWood: new THREE.MeshStandardMaterial({ color: "#2b1f17", roughness: 0.75 }),
  laminate: new THREE.MeshStandardMaterial({ color: "#7e7a6b", roughness: 0.6 }),
  plastic: new THREE.MeshStandardMaterial({ color: "#b8b19c", roughness: 0.55 }),
  blackPlastic: new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.5 }),
  mattress: new THREE.MeshStandardMaterial({ color: "#8a8270", roughness: 1 }),
  stainedCloth: new THREE.MeshStandardMaterial({ color: "#6e6553", roughness: 1 }),
  curtain: new THREE.MeshStandardMaterial({ color: "#5d6b62", roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
  paper: new THREE.MeshStandardMaterial({ color: "#cfc8b2", roughness: 1, side: THREE.DoubleSide }),
  glassFog: new THREE.MeshStandardMaterial({ color: "#7f8583", emissive: "#5d6361", emissiveIntensity: 0.6, roughness: 0.2 }),
  tube: new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#e8f0e6", emissiveIntensity: 1.6 }),
  tubeOff: new THREE.MeshStandardMaterial({ color: "#555", emissive: "#000", roughness: 0.6 }),
  redGlow: new THREE.MeshStandardMaterial({ color: "#3a0000", emissive: "#ff1a10", emissiveIntensity: 2.2 }),
  greenGlow: new THREE.MeshStandardMaterial({ color: "#002a10", emissive: "#2cff6a", emissiveIntensity: 1.4 }),
};
