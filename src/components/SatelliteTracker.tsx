"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Satellite, Loader2, Users, Info, X, Maximize2, Minimize2 } from "lucide-react";
import { isWebglAvailable } from "@/lib/webglSupport";
import { propagateAll, SatellitePosition, TleEntry } from "@/lib/satellitePropagation";
import SatelliteInspector from "@/components/SatelliteInspector";
import { paintWorldTexture } from "@/lib/worldOutline";
import { useMaximizePanel } from "@/lib/useMaximizePanel";
import HudChip from "@/components/HudChip";

type IssPosition = { latitude: number; longitude: number; timestamp: number } | null;
type CloseApproach = {
  designation: string;
  dateCloseApproach: string;
  distanceLunar: number;
  velocityKmS: number;
  diameterEstimateKm: string;
};
type Astronaut = { name: string; craft: string };
type Fireball = { date: string; energyKt: number | null; latitude: number | null; longitude: number | null };
type SpaceData = { iss: IssPosition; closeApproaches: CloseApproach[]; astronauts: Astronaut[]; fireballs: Fireball[]; fetchedAt: string };

const ISS_FACTS = [
  "Altitude: ~408 km above Earth",
  "Speed: ~7.66 km/s (~27,600 km/h)",
  "Orbital period: ~93 minutes — it circles Earth roughly 15.5 times a day",
  "In orbit continuously since November 1998",
];

const GROUP_COLORS: Record<string, number> = {
  stations: 0xf59e0b,
  visual: 0x22d3ee,
};
const GROUP_PALETTE = [0xE11D48, 0x9333ea, 0x10b981, 0xf59e0b, 0x22d3ee, 0xfacc15, 0xf472b6];

function latLonToVector3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function buildSatelliteModel(scale = 1, glowColor = 0xf59e0b, panelColor = 0x2563eb): THREE.Group {
  const group = new THREE.Group();
  const bodyGeo = new THREE.BoxGeometry(0.09 * scale, 0.05 * scale, 0.05 * scale);
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0xf5f5f5 });
  group.add(new THREE.Mesh(bodyGeo, bodyMat));

  const panelGeo = new THREE.BoxGeometry(0.16 * scale, 0.005 * scale, 0.06 * scale);
  const panelMat = new THREE.MeshBasicMaterial({ color: panelColor });
  const panelL = new THREE.Mesh(panelGeo, panelMat);
  panelL.position.x = -0.17 * scale;
  const panelR = new THREE.Mesh(panelGeo, panelMat);
  panelR.position.x = 0.17 * scale;
  group.add(panelL, panelR);

  const glowGeo = new THREE.SphereGeometry(0.09 * scale, 8, 8);
  const glowMat = new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.4 });
  group.add(new THREE.Mesh(glowGeo, glowMat));
  return group;
}

// A denser lat/lon graticule than a plain wireframe sphere — 15° meridians
// and parallels, each built as a ring of tiny segments so the whole thing
// is one draw call. Purely a chrome/density upgrade, not new data.
function buildGraticule(radius: number, color: number, opacity: number): THREE.LineSegments {
  const positions: number[] = [];
  const SEG = 48;
  for (let lat = -75; lat <= 75; lat += 15) {
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2;
      const a1 = ((i + 1) / SEG) * Math.PI * 2;
      const phi = (90 - lat) * (Math.PI / 180);
      const p0 = new THREE.Vector3(
        -radius * Math.sin(phi) * Math.cos(a0),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(a0)
      );
      const p1 = new THREE.Vector3(
        -radius * Math.sin(phi) * Math.cos(a1),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(a1)
      );
      positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
    }
  }
  for (let lon = 0; lon < 360; lon += 15) {
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI - Math.PI / 2;
      const a1 = ((i + 1) / SEG) * Math.PI - Math.PI / 2;
      const theta = (lon + 180) * (Math.PI / 180);
      const p0 = new THREE.Vector3(
        -radius * Math.cos(a0) * Math.cos(theta),
        radius * Math.sin(a0),
        radius * Math.cos(a0) * Math.sin(theta)
      );
      const p1 = new THREE.Vector3(
        -radius * Math.cos(a1) * Math.cos(theta),
        radius * Math.sin(a1),
        radius * Math.cos(a1) * Math.sin(theta)
      );
      positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  return new THREE.LineSegments(geo, mat);
}

function makeGlowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// A big soft warm halo sitting behind the Earth — the "glowing nebula
// core" look from the reference mood board (a dense colorful particle
// cloud with an amber/pink glow at its center). Painted once as a texture
// and shown on a camera-facing sprite rather than built from geometry,
// since it's pure atmosphere, not a real object.
function makeNebulaGlowTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,214,140,0.85)");
  g.addColorStop(0.18, "rgba(255,170,110,0.6)");
  g.addColorStop(0.4, "rgba(244,114,182,0.42)");
  g.addColorStop(0.65, "rgba(168,85,247,0.22)");
  g.addColorStop(1, "rgba(168,85,247,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

type SceneHandle = {
  updateSatellites: (positions: SatellitePosition[]) => void;
  updateIss: (iss: IssPosition) => void;
  dispose: () => void;
};

function vector3ToLatLon(p: THREE.Vector3, radius: number): { lat: number; lon: number } {
  const lat = 90 - (Math.acos(p.y / radius) * 180) / Math.PI;
  let lon = (Math.atan2(p.z, -p.x) * 180) / Math.PI - 180;
  if (lon < -180) lon += 360;
  if (lon > 180) lon -= 360;
  return { lat, lon };
}

function setupScene(
  mount: HTMLDivElement,
  onSatelliteClick: (name: string) => void,
  onHoverLatLon: (coords: { lat: number; lon: number } | null) => void
): SceneHandle {
  const width = mount.clientWidth;
  const height = mount.clientHeight;
  const RADIUS = 1.75;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
  camera.position.set(0, 1.4, 6);
  // Without this the camera looks straight down -Z from its raised
  // position instead of tilting toward the globe, which pushes the whole
  // Earth toward the bottom of the frame instead of centering it.
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  mount.appendChild(renderer.domElement);

  const earthGroup = new THREE.Group();
  scene.add(earthGroup);

  // Nebula halo behind the globe — camera-facing sprite, added to the
  // scene (not earthGroup) so it never rotates with the drag gesture and
  // stays a fixed atmospheric backdrop.
  const nebulaSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeNebulaGlowTexture(),
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  nebulaSprite.scale.set(9, 9, 1);
  nebulaSprite.position.set(0, 0, -1.2);
  scene.add(nebulaSprite);

  // Real continent silhouettes painted onto a canvas texture and mapped
  // onto the sphere via standard equirectangular UVs — a colorful, "real"
  // -looking Earth instead of a flat dark ball. See lib/worldOutline.ts.
  const earthCanvas = document.createElement("canvas");
  earthCanvas.width = 2048;
  earthCanvas.height = 1024;
  paintWorldTexture(earthCanvas);
  const earthTexture = new THREE.CanvasTexture(earthCanvas);
  earthTexture.colorSpace = THREE.SRGBColorSpace;

  // A real lit material (not the flat MeshBasicMaterial everything else
  // here uses) plus an actual directional "sun" + dim ambient fill, so the
  // globe gets a real terminator/specular instead of looking like a flat
  // painted ball — the texture upgrade above only goes so far without an
  // actual light responding to the sphere's normals.
  const coreGeo = new THREE.SphereGeometry(1.5, 64, 64);
  const coreMat = new THREE.MeshStandardMaterial({ map: earthTexture, roughness: 0.82, metalness: 0.08 });
  const earthCore = new THREE.Mesh(coreGeo, coreMat);
  earthGroup.add(earthCore);

  const sunLight = new THREE.DirectionalLight(0xdbe9ff, 1.1);
  sunLight.position.set(2.5, 1.2, 3);
  scene.add(sunLight);
  // A separate warm light from behind-left, grazing the sphere's edge —
  // this is what produces the golden limb/rim glow from the reference
  // image, distinct from the cooler light doing the general shading.
  const rimLight = new THREE.DirectionalLight(0xffb870, 2.4);
  rimLight.position.set(-3.5, 0.4, -1.6);
  scene.add(rimLight);
  const ambientLight = new THREE.AmbientLight(0x1c3550, 1.0);
  scene.add(ambientLight);

  const graticule = buildGraticule(1.505, 0x67e8f9, 0.24);
  earthGroup.add(graticule);

  const atmoGeo = new THREE.SphereGeometry(1.65, 24, 24);
  const atmoMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.1, side: THREE.BackSide });
  earthGroup.add(new THREE.Mesh(atmoGeo, atmoMat));

  const atmoGeo2 = new THREE.SphereGeometry(1.58, 24, 24);
  const atmoMat2 = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.06, side: THREE.BackSide });
  earthGroup.add(new THREE.Mesh(atmoGeo2, atmoMat2));

  const circleMat1 = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.55 });
  const equatorPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    equatorPts.push(new THREE.Vector3(Math.cos(a) * 1.51, 0, Math.sin(a) * 1.51));
  }
  const equatorGeo = new THREE.BufferGeometry().setFromPoints(equatorPts);
  earthGroup.add(new THREE.Line(equatorGeo, circleMat1));

  // Altitude-band reference rings — LEO/MEO/GEO — purely a visual scale
  // reference (labeled as such in the legend), not per-satellite data.
  const bandGeoLEO = new THREE.TorusGeometry(1.9, 0.0025, 6, 96);
  const bandMatLEO = new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.22 });
  const bandLEO = new THREE.Mesh(bandGeoLEO, bandMatLEO);
  bandLEO.rotation.x = Math.PI / 2;
  earthGroup.add(bandLEO);

  const bandGeoGEO = new THREE.TorusGeometry(2.35, 0.0025, 6, 96);
  const bandMatGEO = new THREE.MeshBasicMaterial({ color: 0xc026d3, transparent: true, opacity: 0.18 });
  const bandGEO = new THREE.Mesh(bandGeoGEO, bandMatGEO);
  bandGEO.rotation.x = Math.PI / 2;
  earthGroup.add(bandGEO);

  // Radar-style sweep — a thin translucent fan that spins continuously,
  // reinforcing the "active scan" feel. Pure ambience, zIndex-less (it's
  // in the 3D scene), never blocks the click/hover raycasts below.
  const sweepGeo = new THREE.CircleGeometry(1.85, 32, 0, Math.PI / 7);
  const sweepMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false });
  const sweep = new THREE.Mesh(sweepGeo, sweepMat);
  sweep.rotation.x = Math.PI / 2;
  earthGroup.add(sweep);

  // Dramatic long orbital trajectory lines, sweeping across at varied
  // inclinations/radii and mixed colors — purely atmospheric, styled after
  // the reference mood board's crossing red/amber/cyan orbit-line look.
  // Not tied to any real object.
  const TRAJECTORY_COLORS = [0xef4444, 0xf43f5e, 0xf59e0b, 0xfbbf24, 0x22d3ee, 0xa855f7];
  const trajectoryGeos: THREE.BufferGeometry[] = [];
  const trajectoryMats: THREE.LineBasicMaterial[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = 2.1 + Math.random() * 1.6;
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j <= 96; j++) {
      const a = (j / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: TRAJECTORY_COLORS[i % TRAJECTORY_COLORS.length],
      transparent: true,
      opacity: 0.16 + Math.random() * 0.14,
    });
    const line = new THREE.Line(geo, mat);
    line.rotation.x = Math.random() * Math.PI;
    line.rotation.y = Math.random() * Math.PI;
    line.rotation.z = Math.random() * Math.PI;
    earthGroup.add(line);
    trajectoryGeos.push(geo);
    trajectoryMats.push(mat);
  }

  // Tight-hugging "flight path" data arcs right at the surface — the
  // dense woven-line look from the reference image, distinct from the
  // far orbital rings above.
  const ARC_COLORS = [0xffffff, 0xe0f7fa, 0x67e8f9, 0xa5f3fc];
  for (let i = 0; i < 42; i++) {
    const radius = 1.52 + Math.random() * 0.14;
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j <= 64; j++) {
      const a = (j / 64) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: ARC_COLORS[i % ARC_COLORS.length],
      transparent: true,
      opacity: 0.06 + Math.random() * 0.1,
    });
    const line = new THREE.Line(geo, mat);
    line.rotation.x = Math.random() * Math.PI;
    line.rotation.y = Math.random() * Math.PI;
    line.rotation.z = Math.random() * Math.PI;
    earthGroup.add(line);
    trajectoryGeos.push(geo);
    trajectoryMats.push(mat);
  }

  const glowTexture = makeGlowTexture();

  // Dense decorative satellite-density swarm — NOT individually tracked
  // real objects (those are the smaller `satPoints` cloud below, driven by
  // real CelesTrak TLE data). This layer exists purely so the globe reads
  // as "crowded with satellites" the way the reference does, styled after
  // the real rough category breakdown of active satellites, but every dot's
  // exact position here is randomized, not a real object — the UI legend
  // says so explicitly, don't let that caveat get lost in a future edit.
  type SwarmCategory = { label: string; color: number; count: number; latSpread: number; radiusMin: number; radiusMax: number };
  const SWARM_CATEGORIES: SwarmCategory[] = [
    { label: "Starlink", color: 0x22d3ee, count: 2600, latSpread: 90, radiusMin: 1.78, radiusMax: 1.92 },
    { label: "OneWeb", color: 0x818cf8, count: 500, latSpread: 90, radiusMin: 1.98, radiusMax: 2.05 },
    { label: "GPS / GNSS", color: 0x34d399, count: 350, latSpread: 80, radiusMin: 2.15, radiusMax: 2.25 },
    { label: "Geo belt", color: 0xf59e0b, count: 550, latSpread: 6, radiusMin: 2.5, radiusMax: 2.6 },
    { label: "Weather", color: 0xe2e8f0, count: 150, latSpread: 85, radiusMin: 2.0, radiusMax: 2.3 },
    { label: "Other / debris", color: 0x94a3b8, count: 1400, latSpread: 90, radiusMin: 1.85, radiusMax: 2.45 },
  ];
  const swarmTotal = SWARM_CATEGORIES.reduce((s, c) => s + c.count, 0);
  const swarmPositions = new Float32Array(swarmTotal * 3);
  const swarmColors = new Float32Array(swarmTotal * 3);
  {
    let idx = 0;
    const c = new THREE.Color();
    for (const cat of SWARM_CATEGORIES) {
      c.set(cat.color);
      for (let i = 0; i < cat.count; i++) {
        const lat = (Math.random() * 2 - 1) * cat.latSpread;
        const lon = Math.random() * 360 - 180;
        const radius = cat.radiusMin + Math.random() * (cat.radiusMax - cat.radiusMin);
        const p = latLonToVector3(lat, lon, radius);
        swarmPositions[idx * 3] = p.x;
        swarmPositions[idx * 3 + 1] = p.y;
        swarmPositions[idx * 3 + 2] = p.z;
        swarmColors[idx * 3] = c.r;
        swarmColors[idx * 3 + 1] = c.g;
        swarmColors[idx * 3 + 2] = c.b;
        idx++;
      }
    }
  }
  const swarmGeo = new THREE.BufferGeometry();
  swarmGeo.setAttribute("position", new THREE.BufferAttribute(swarmPositions, 3));
  swarmGeo.setAttribute("color", new THREE.BufferAttribute(swarmColors, 3));
  const swarmMat = new THREE.PointsMaterial({
    size: 0.038,
    vertexColors: true,
    map: glowTexture,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const swarmPoints = new THREE.Points(swarmGeo, swarmMat);
  earthGroup.add(swarmPoints);

  // ISS — the detailed "hero" model
  const issModel = buildSatelliteModel(1);
  earthGroup.add(issModel);

  const orbitGeo = new THREE.TorusGeometry(RADIUS, 0.004, 8, 128);
  const orbitMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.3 });
  const orbitRing = new THREE.Mesh(orbitGeo, orbitMat);
  orbitRing.rotation.x = Math.PI / 2.3;
  earthGroup.add(orbitRing);

  const TRAIL_LEN = 60;
  const trailPositions = new Float32Array(TRAIL_LEN * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPositions, 3));
  const trailMat = new THREE.PointsMaterial({ color: 0xf59e0b, size: 0.03, transparent: true, opacity: 0.5 });
  const trailPoints = new THREE.Points(trailGeo, trailMat);
  earthGroup.add(trailPoints);
  const trailHistory: THREE.Vector3[] = [];

  // Other real satellites — each a real tracked object, rendered as an
  // actual satellite model (body + solar panels, the same builder used for
  // the ISS hero model below) instead of a flat sprite, scaled up so it
  // reads as a real object, with its own glow halo sprite and a slow
  // continuous spin so it visibly moves in place. Positions still come
  // from real SGP4 propagation (updateSatellites below); the model glides
  // toward each new real position via lerp rather than teleporting.
  const MAX_SATS = 60;
  const LABEL_SAT_COUNT = 10;
  type SatEntry = {
    model: THREE.Group;
    glow: THREE.Sprite;
    targetPos: THREE.Vector3;
    currentPos: THREE.Vector3;
    hasPos: boolean;
    baseGlowScale: number;
    spinSpeed: number;
    wobbleSeed: number;
  };
  const satEntries: SatEntry[] = [];
  for (let i = 0; i < MAX_SATS; i++) {
    const modelScale = 0.85 + Math.random() * 0.5;
    const model = buildSatelliteModel(modelScale, 0xffffff, 0x38bdf8);
    model.visible = false;
    earthGroup.add(model);

    const glowScale = 0.7 + Math.random() * 0.35;
    const glowMat = new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(glowScale, glowScale, 1);
    glow.visible = false;
    earthGroup.add(glow);

    satEntries.push({
      model,
      glow,
      targetPos: new THREE.Vector3(),
      currentPos: new THREE.Vector3(),
      hasPos: false,
      baseGlowScale: glowScale,
      spinSpeed: (Math.random() < 0.5 ? -1 : 1) * (0.004 + Math.random() * 0.008),
      wobbleSeed: Math.random() * Math.PI * 2,
    });
  }
  let currentSatCount = 0;
  let currentSatMeta: SatellitePosition[] = [];

  // HTML label + SVG leader-line overlay for a subset of the real
  // satellites — name, group and altitude, same pattern as ThreatGlobe's
  // comet labels.
  const satOverlay = document.createElement("div");
  satOverlay.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
  mount.appendChild(satOverlay);
  const satSvgNS = "http://www.w3.org/2000/svg";
  const satSvg = document.createElementNS(satSvgNS, "svg");
  satSvg.setAttribute("width", "100%");
  satSvg.setAttribute("height", "100%");
  satSvg.style.cssText = "position:absolute;inset:0;";
  satOverlay.appendChild(satSvg);
  const satLabelEls = Array.from({ length: LABEL_SAT_COUNT }, (_, i) => {
    const line = document.createElementNS(satSvgNS, "line");
    line.setAttribute("stroke", "#67e8f9");
    line.setAttribute("stroke-opacity", "0");
    line.setAttribute("stroke-width", "1");
    satSvg.appendChild(line);

    const el = document.createElement("div");
    el.className =
      "absolute -translate-y-1/2 whitespace-nowrap rounded border bg-panel/85 backdrop-blur-sm px-1.5 py-0.5 text-[9px] leading-tight hud-text";
    el.style.opacity = "0";
    satOverlay.appendChild(el);
    return { line, el, side: i % 2 === 0 ? 1 : -1, active: false };
  });

  // Constellation lines between nearby satellites — the dense "network" look.
  const MAX_LINES = MAX_SATS * 2;
  const linePositions = new Float32Array(MAX_LINES * 2 * 3);
  const lineColors = new Float32Array(MAX_LINES * 2 * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
  lineGeo.setAttribute("color", new THREE.BufferAttribute(lineColors, 3));
  lineGeo.setDrawRange(0, 0);
  const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  earthGroup.add(lines);

  // Dense multi-colored starfield/nebula-dust backdrop — styled after the
  // reference mood board's dense colorful particle field (not scientific,
  // purely atmospheric depth, same "density and mood" the satellite swarm
  // above already uses that same reasoning for). Two layers: a large sparse
  // set of brighter "foreground" stars, and a much denser, smaller, dimmer
  // "dust" layer concentrated toward the center for that glowing-core look.
  const starPalette = [
    new THREE.Color(0xffffff), new THREE.Color(0x93c5fd), new THREE.Color(0xf472b6),
    new THREE.Color(0xd8b4fe), new THREE.Color(0xf472b6), new THREE.Color(0xfbbf24),
    new THREE.Color(0x5eead4), new THREE.Color(0xc4b5fd), new THREE.Color(0xe879f9),
    new THREE.Color(0x2dd4bf),
  ];
  const glowTex = makeGlowTexture();
  const starGeos: THREE.BufferGeometry[] = [];
  const starMats: THREE.Material[] = [];

  function buildStarLayer(count: number, spread: number, zBias: number, size: number, opacity: number, centerBias: number) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // centerBias > 0 pulls points toward the origin (denser "core"),
      // via a simple power-curve on the radial distance.
      const r = Math.pow(Math.random(), 1 + centerBias) * spread;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi) * 0.4 + zBias;
      const c = starPalette[Math.floor(Math.random() * starPalette.length)];
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size, vertexColors: true, transparent: true, opacity, map: glowTex,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    scene.add(new THREE.Points(geo, mat));
    starGeos.push(geo);
    starMats.push(mat);
  }

  buildStarLayer(900, 26, -6, 0.065, 0.85, 0);
  buildStarLayer(4200, 15, -3, 0.034, 0.7, 0.65);

  let isDragging = false;
  let dragDistance = 0;
  let prevX = 0, prevY = 0;
  let velY = 0.0014;
  const tmpColor = new THREE.Color();

  function onDown(e: PointerEvent) { isDragging = true; dragDistance = 0; prevX = e.clientX; prevY = e.clientY; }
  function onMove(e: PointerEvent) {
    if (!isDragging) return;
    const dx = e.clientX - prevX, dy = e.clientY - prevY;
    dragDistance += Math.abs(dx) + Math.abs(dy);
    earthGroup.rotation.y += dx * 0.005;
    earthGroup.rotation.x += dy * 0.005;
    velY = dx * 0.0003;
    prevX = e.clientX; prevY = e.clientY;
  }
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: 0.08 };
  const pointerNdc = new THREE.Vector2();
  function onUp(e: PointerEvent) {
    isDragging = false;
    if (dragDistance >= 4) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);

    const issHit = raycaster.intersectObjects(issModel.children, true);
    if (issHit.length > 0) { onSatelliteClick("ISS (ZARYA)"); return; }

    const satHit = raycaster.intersectObjects(
      satEntries.slice(0, currentSatCount).map((e) => e.model),
      true
    );
    if (satHit.length > 0) {
      const idx = satEntries.findIndex((e) => e.model === satHit[0].object.parent);
      if (idx >= 0 && currentSatMeta[idx]) onSatelliteClick(currentSatMeta[idx].name);
    }
  }
  // Separate, always-on tracker (not gated by isDragging like onMove) purely
  // for the live lat/lon readout under the cursor — cheap to keep updated,
  // the actual raycast against it is throttled inside animate().
  let hoverClientX = -1, hoverClientY = -1, hasHover = false;
  function onHoverMove(e: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    hoverClientX = e.clientX - rect.left;
    hoverClientY = e.clientY - rect.top;
    hasHover = true;
  }
  function onHoverLeave() {
    hasHover = false;
    onHoverLatLon(null);
  }

  renderer.domElement.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  renderer.domElement.addEventListener("pointermove", onHoverMove);
  renderer.domElement.addEventListener("pointerleave", onHoverLeave);

  let raf: number;
  let stopped = false;
  let frame = 0;
  let latestIss: IssPosition = null;
  const clock = new THREE.Clock();
  const projected = new THREE.Vector3();

  function animate() {
    if (stopped) return;
    raf = requestAnimationFrame(animate);
    frame++;
    const t = clock.getElapsedTime();

    if (!isDragging) earthGroup.rotation.y += velY;
    orbitRing.rotation.z += 0.0015;
    sweep.rotation.y -= 0.006;
    issModel.rotation.y += 0.01;

    // Real satellites: glide toward their latest real SGP4 position, with
    // a small wobble + a slow continuous spin so each model visibly moves
    // even between the 3s position updates, plus a breathing glow halo.
    for (let i = 0; i < currentSatCount; i++) {
      const entry = satEntries[i];
      entry.currentPos.lerp(entry.targetPos, 0.025);
      const wobble = new THREE.Vector3(
        Math.sin(t * 0.8 + entry.wobbleSeed) * 0.02,
        Math.cos(t * 0.65 + entry.wobbleSeed) * 0.02,
        Math.sin(t * 0.5 + entry.wobbleSeed * 1.3) * 0.02
      );
      const p = entry.currentPos.clone().add(wobble);
      entry.model.position.copy(p);
      entry.glow.position.copy(p);
      entry.model.rotation.y += entry.spinSpeed;
      entry.model.rotation.x = Math.sin(t * 0.3 + entry.wobbleSeed) * 0.15;

      const glowPulse = 1 + Math.sin(t * 2.2 + entry.wobbleSeed) * 0.25;
      entry.glow.scale.set(entry.baseGlowScale * glowPulse, entry.baseGlowScale * glowPulse, 1);

      const world = entry.model.getWorldPosition(projected).clone();
      world.project(camera);
      const sx = ((world.x + 1) / 2) * width;
      const sy = ((1 - world.y) / 2) * height;
      const behind = world.z > 1;

      if (i >= satLabelEls.length || !satLabelEls[i].active) continue;
      const { line, el, side } = satLabelEls[i];
      if (behind || sx < -50 || sx > width + 50) {
        el.style.opacity = "0";
        line.setAttribute("stroke-opacity", "0");
        continue;
      }
      const lx = Math.min(width - 10, Math.max(10, sx + side * 50));
      const ly = sy;
      el.style.opacity = "0.95";
      el.style.left = `${lx + (side > 0 ? 4 : -4)}px`;
      el.style.top = `${ly}px`;
      el.style.transform = `translate(${side > 0 ? "0" : "-100%"}, -50%)`;
      line.setAttribute("x1", String(sx));
      line.setAttribute("y1", String(sy));
      line.setAttribute("x2", String(lx));
      line.setAttribute("y2", String(ly));
      line.setAttribute("stroke-opacity", "0.4");
    }

    if (frame % 6 === 0) {
      if (hasHover && !isDragging) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointerNdc.x = (hoverClientX / rect.width) * 2 - 1;
        pointerNdc.y = -(hoverClientY / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointerNdc, camera);
        const hit = raycaster.intersectObject(earthCore, false);
        if (hit.length > 0) {
          const local = earthCore.worldToLocal(hit[0].point.clone());
          onHoverLatLon(vector3ToLatLon(local, 1.5));
        } else {
          onHoverLatLon(null);
        }
      } else {
        onHoverLatLon(null);
      }
    }

    if (latestIss) {
      const pos = latLonToVector3(latestIss.latitude, latestIss.longitude, RADIUS);
      issModel.position.copy(pos);
      issModel.lookAt(0, 0, 0);
      if (frame % 20 === 0) {
        trailHistory.push(pos.clone());
        if (trailHistory.length > TRAIL_LEN) trailHistory.shift();
        const posAttr = trailGeo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < TRAIL_LEN; i++) {
          const p = trailHistory[i];
          if (p) posAttr.setXYZ(i, p.x, p.y, p.z); else posAttr.setXYZ(i, 0, 0, 0);
        }
        posAttr.needsUpdate = true;
      }
    }

    renderer.render(scene, camera);
  }
  animate();

  function updateSatellites(positions: SatellitePosition[]) {
    currentSatMeta = positions.slice(0, MAX_SATS);
    currentSatCount = currentSatMeta.length;

    const points3d: THREE.Vector3[] = [];
    currentSatMeta.forEach((sat, i) => {
      const altScale = RADIUS + Math.min(0.5, sat.altitudeKm / 6000); // higher orbits sit farther out, visually
      const p = latLonToVector3(sat.latitude, sat.longitude, altScale);
      points3d.push(p);

      const entry = satEntries[i];
      entry.targetPos.copy(p);
      if (!entry.hasPos) {
        entry.currentPos.copy(p);
        entry.hasPos = true;
      }
      entry.model.visible = true;
      entry.glow.visible = true;
      const paletteColor = GROUP_COLORS[sat.group] ?? GROUP_PALETTE[i % GROUP_PALETTE.length];
      // model.children[3] is the small glow sphere baked into
      // buildSatelliteModel; tint it plus the standalone halo sprite so
      // both read as the same group color.
      const innerGlowMesh = entry.model.children[3] as THREE.Mesh;
      (innerGlowMesh.material as THREE.MeshBasicMaterial).color.set(paletteColor);
      (entry.glow.material as THREE.SpriteMaterial).color.set(paletteColor);

      if (i < satLabelEls.length) {
        const { el } = satLabelEls[i];
        const hex = `#${paletteColor.toString(16).padStart(6, "0")}`;
        el.style.borderColor = `${hex}80`;
        // sat.name comes from the TLE feed (/api/space/tle, an external
        // source) — textContent, not innerHTML, so nothing in it can
        // ever be parsed as markup.
        el.replaceChildren();
        const nameSpan = document.createElement("span");
        nameSpan.style.color = hex;
        nameSpan.textContent = sat.name;
        const detailSpan = document.createElement("span");
        detailSpan.className = "text-slate-500";
        detailSpan.textContent = ` ${sat.group} · ${sat.altitudeKm.toFixed(0)}km`;
        el.append(nameSpan, detailSpan);
        satLabelEls[i].active = true;
      }
    });
    for (let i = currentSatCount; i < MAX_SATS; i++) {
      satEntries[i].model.visible = false;
      satEntries[i].glow.visible = false;
      if (i < satLabelEls.length) satLabelEls[i].active = false;
    }

    // Rebuild constellation lines between satellites that are near each other.
    const linePosAttr = lineGeo.attributes.position as THREE.BufferAttribute;
    const lineColAttr = lineGeo.attributes.color as THREE.BufferAttribute;
    let lineIdx = 0;
    for (let i = 0; i < points3d.length && lineIdx < MAX_LINES; i++) {
      let links = 0;
      for (let j = i + 1; j < points3d.length && links < 2 && lineIdx < MAX_LINES; j++) {
        if (points3d[i].distanceTo(points3d[j]) < 1.1) {
          linePosAttr.setXYZ(lineIdx * 2, points3d[i].x, points3d[i].y, points3d[i].z);
          linePosAttr.setXYZ(lineIdx * 2 + 1, points3d[j].x, points3d[j].y, points3d[j].z);
          const c1 = GROUP_COLORS[currentSatMeta[i].group] ?? GROUP_PALETTE[i % GROUP_PALETTE.length];
          tmpColor.set(c1);
          lineColAttr.setXYZ(lineIdx * 2, tmpColor.r, tmpColor.g, tmpColor.b);
          lineColAttr.setXYZ(lineIdx * 2 + 1, tmpColor.r, tmpColor.g, tmpColor.b);
          lineIdx++;
          links++;
        }
      }
    }
    linePosAttr.needsUpdate = true;
    lineColAttr.needsUpdate = true;
    lineGeo.setDrawRange(0, lineIdx * 2);
  }

  function updateIss(iss: IssPosition) {
    latestIss = iss;
  }

  function handleResize() {
    const w = mount.clientWidth, h = mount.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener("resize", handleResize);

  function dispose() {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", handleResize);
    renderer.domElement.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    renderer.domElement.removeEventListener("pointermove", onHoverMove);
    renderer.domElement.removeEventListener("pointerleave", onHoverLeave);
    [coreGeo, graticule.geometry, atmoGeo, atmoGeo2, equatorGeo, bandGeoLEO, bandGeoGEO, sweepGeo, orbitGeo, trailGeo, swarmGeo, lineGeo, ...starGeos, ...trajectoryGeos].forEach((g) => g.dispose());
    [coreMat, graticule.material as THREE.Material, atmoMat, atmoMat2, circleMat1, bandMatLEO, bandMatGEO, sweepMat, orbitMat, trailMat, swarmMat, lineMat, ...starMats, ...trajectoryMats].forEach((m) => m.dispose());
    satEntries.forEach((e) => {
      e.model.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      (e.glow.material as THREE.SpriteMaterial).dispose();
    });
    glowTexture.dispose();
    glowTex.dispose();
    (nebulaSprite.material as THREE.SpriteMaterial).map?.dispose();
    nebulaSprite.material.dispose();
    earthTexture.dispose();
    renderer.dispose();
    if (satOverlay.parentElement === mount) mount.removeChild(satOverlay);
    if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
  }

  return { updateSatellites, updateIss, dispose };
}

export default function SatelliteTracker() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const [data, setData] = useState<SpaceData | null>(null);
  const [tleList, setTleList] = useState<TleEntry[]>([]);
  const [satCount, setSatCount] = useState(0);
  const [satList, setSatList] = useState<SatellitePosition[]>([]);
  const [webglReady, setWebglReady] = useState<boolean | null>(null);
  const [showInfo, setShowInfo] = useState<string | null>(null);
  const { maximized, toggleMaximized } = useMaximizePanel();
  const [hoverLatLon, setHoverLatLon] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    setWebglReady(isWebglAvailable());
  }, []);

  useEffect(() => {
    function load() {
      fetch("/api/space").then((r) => r.json()).then(setData).catch(() => {});
    }
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetch("/api/space/tle")
      .then((r) => r.json())
      .then((d) => setTleList(d.satellites ?? []))
      .catch(() => setTleList([]));
  }, []);

  useEffect(() => {
    if (webglReady !== true) return;
    const mount = mountRef.current;
    if (!mount) return;
    try {
      sceneRef.current = setupScene(mount, (name) => setShowInfo(name), setHoverLatLon);
    } catch {
      setWebglReady(false);
      return;
    }
    return () => sceneRef.current?.dispose();
  }, [webglReady]);

  useEffect(() => {
    sceneRef.current?.updateIss(data?.iss ?? null);
  }, [data]);

  useEffect(() => {
    if (tleList.length === 0 || !sceneRef.current) return;
    function tick() {
      const positions = propagateAll(tleList, new Date());
      setSatCount(positions.length);
      setSatList(positions);
      sceneRef.current?.updateSatellites(positions);
    }
    tick();
    const id = setInterval(tick, 3000); // real orbital math, recomputed every 3s
    return () => clearInterval(id);
  }, [tleList, webglReady]);

  return (
    <div
      className={
        maximized
          ? "glass-panel !bg-[#05040a] p-4 flex flex-col !fixed !inset-0 !z-50 rounded-none overflow-y-auto"
          : "glass-panel p-4 flex flex-col"
      }
    >
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1.5">
        <div className="flex items-center gap-2">
          <Satellite className="h-4 w-4 text-accent" />
          <HudChip color="amber">GEOCENTRIC MAP</HudChip>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-slate-500">
            {satCount > 0 ? `${satCount} real satellites tracked` : "loading orbital data…"} · drag to rotate · click any dot · hover for lat/lon
          </span>
          <button
            onClick={toggleMaximized}
            className="text-slate-500 hover:text-accent-glow transition-colors"
            title={maximized ? "Exit fullscreen (Esc)" : "Fullscreen"}
          >
            {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className={`relative rounded-lg border border-border/60 overflow-hidden ${maximized ? "h-[75vh]" : "min-h-[420px]"}`}>
          {webglReady === true && <div ref={mountRef} className="absolute inset-0 cursor-pointer" />}
          {webglReady === false && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500 text-center px-6">
              3D rendering unavailable on this device — real data is still shown to the right.
            </div>
          )}
          {(!data || webglReady === null) && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-5 w-5 text-accent animate-spin" />
            </div>
          )}
          {data?.iss && (
            <div className="absolute bottom-2 left-2 rounded-lg border border-amber-700/50 bg-amber-950/60 backdrop-blur-sm px-2.5 py-1.5 text-[10px] hud-text">
              <p className="text-amber-300 font-bold">ISS — LIVE POSITION</p>
              <p className="text-slate-200 mt-0.5">LAT {data.iss.latitude.toFixed(2)}° · LON {data.iss.longitude.toFixed(2)}°</p>
            </div>
          )}
          {data && data.astronauts.length > 0 && (
            <div className="absolute top-2 right-2 rounded-lg border border-purple-700/50 bg-purple-950/60 backdrop-blur-sm px-2.5 py-1.5 text-[10px] hud-text flex items-center gap-1.5">
              <Users className="h-3 w-3 text-purple-300" />
              <span className="text-purple-300 font-bold">{data.astronauts.length} PEOPLE IN SPACE NOW</span>
            </div>
          )}
          {satCount > 0 && (
            <div className="absolute top-2 left-2 rounded-lg border border-cyan-700/50 bg-cyan-950/60 backdrop-blur-sm px-2.5 py-1.5 text-[10px] hud-text">
              <span className="text-cyan-300 font-bold">{satCount} SATELLITES · REAL TLE ORBITAL DATA</span>
            </div>
          )}

          {webglReady === true && (
            <div className="absolute bottom-2 left-2 right-2 rounded-lg border border-border/60 bg-[#0d0a18]/75 backdrop-blur-sm px-2.5 py-1.5 text-[9px] hud-text text-slate-500 flex items-center flex-wrap gap-x-3 gap-y-1">
              <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#22d3ee" }} />STARLINK</span>
              <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#818cf8" }} />ONEWEB</span>
              <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#34d399" }} />GPS/GNSS</span>
              <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#f59e0b" }} />GEO BELT</span>
              <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300" />WEATHER</span>
              <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-500" />OTHER/DEBRIS</span>
              <span className="text-slate-600">· density illustrative, not per-object</span>
              <span className="text-terminal-bright ml-auto">
                {hoverLatLon ? `CURSOR ${hoverLatLon.lat >= 0 ? "N" : "S"}${Math.abs(hoverLatLon.lat).toFixed(1)}° ${hoverLatLon.lon >= 0 ? "E" : "W"}${Math.abs(hoverLatLon.lon).toFixed(1)}°` : "CURSOR —"}
              </span>
            </div>
          )}

          {showInfo && (
            <div className="absolute inset-0 bg-[#05040a]/95 backdrop-blur-sm p-4 overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-accent-glow flex items-center gap-1.5">
                  <Info className="h-4 w-4" /> {showInfo}
                </p>
                <button onClick={() => setShowInfo(null)} className="text-slate-500 hover:text-slate-300">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {showInfo === "ISS (ZARYA)" ? (
                <ul className="space-y-1.5 mb-4">
                  {ISS_FACTS.map((f, i) => (
                    <li key={i} className="text-xs text-slate-300 flex gap-2"><span className="text-accent-glow">›</span>{f}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-300 mb-4">
                  Real object tracked from CelesTrak's public orbital element (TLE) catalog, position
                  computed live via SGP4 propagation — the same orbital mechanics model used
                  operationally for satellite tracking.
                </p>
              )}
              {data?.astronauts && data.astronauts.length > 0 && (
                <>
                  <p className="text-[11px] text-slate-500 uppercase mb-1.5">People currently in space (real, live)</p>
                  <div className="space-y-1">
                    {data.astronauts.map((a) => (
                      <p key={a.name} className="text-xs text-slate-300">{a.name} <span className="text-slate-500">— {a.craft}</span></p>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className={maximized ? "h-[75vh]" : "min-h-[420px]"}>
          <SatelliteInspector />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
        <div className="glass-panel p-3">
          <p className="text-[10px] text-terminal uppercase tracking-wide mb-1.5 hud-text">
            Near-Earth Close Approaches · NASA JPL, next 60d
          </p>
          {data?.closeApproaches.length === 0 && <p className="text-xs text-slate-500">No data available right now.</p>}
          <div className="space-y-1 max-h-[220px] overflow-y-auto">
            {data?.closeApproaches.map((ca) => (
              <div key={ca.designation + ca.dateCloseApproach} className="rounded bg-[#0d0a18] border border-border/60 px-2 py-1">
                <p className="text-[11px] font-mono text-terminal-bright">{ca.designation}</p>
                <p className="text-[9px] text-slate-500 mt-0.5">
                  {ca.dateCloseApproach} · {ca.distanceLunar.toFixed(1)} LD · {ca.velocityKmS.toFixed(1)} km/s
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel p-3">
          <p className="text-[10px] text-terminal uppercase tracking-wide mb-1.5 hud-text">
            Fireball / Bolide Events · NASA CNEOS (real atmospheric impacts)
          </p>
          {(!data?.fireballs || data.fireballs.length === 0) && <p className="text-xs text-slate-500">No recent events on file.</p>}
          <div className="space-y-1 max-h-[220px] overflow-y-auto">
            {data?.fireballs.map((fb, i) => (
              <div key={fb.date + i} className="rounded bg-[#0d0a18] border border-border/60 px-2 py-1 flex items-center justify-between">
                <p className="text-[10px] font-mono text-slate-300">{fb.date}</p>
                <p className="text-[10px] text-amber-300">{fb.energyKt !== null ? `${fb.energyKt.toFixed(1)} kt` : "—"}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel p-3">
          <p className="text-[10px] text-terminal uppercase tracking-wide mb-1.5 hud-text">
            Orbital Catalogue Stream · {satList.length} objects · CelesTrak
          </p>
          <div className="space-y-0.5 max-h-[220px] overflow-y-auto">
            {satList.map((sat) => (
              <div key={sat.name} className="flex items-center justify-between text-[10px] font-mono px-1.5 py-0.5 odd:bg-[#0d0a18]/60 rounded">
                <span className="text-slate-300 truncate max-w-[130px]">{sat.name}</span>
                <span className="text-slate-500 uppercase">{sat.group}</span>
                <span className="text-terminal-bright">{sat.altitudeKm.toFixed(0)} km</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-[10px] text-slate-600 mt-3 text-center">
        ISS: api.wheretheiss.at · {satCount} satellites: CelesTrak TLE + SGP4 propagation (satellite.js) · Fireballs + asteroids: NASA JPL CNEOS/SBDB · People in space: Open Notify — all free, keyless, live.
      </p>
    </div>
  );
}
