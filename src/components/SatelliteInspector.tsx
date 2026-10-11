"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Boxes, RotateCcw } from "lucide-react";
import { isWebglAvailable } from "@/lib/webglSupport";
import HudChip from "@/components/HudChip";

type PartInfo = { id: string; label: string; color: number; desc: string };

// Generic, educational satellite anatomy — not the internals of the
// specific object tracked in the panel to the left. Every satellite is
// different; this is the illustrative "how do these things generally
// work" cutaway, same spirit as a museum placard, not a fabricated scan.
const PARTS: PartInfo[] = [
  { id: "bus", label: "Main Bus", color: 0xcbd5e1, desc: "The core structure — houses the onboard computer, batteries, and the wiring harness that ties every other part together." },
  { id: "solar", label: "Solar Arrays", color: 0x2563eb, desc: "Photovoltaic panels that convert sunlight into electricity, recharging the batteries once per orbit — even on the night side." },
  { id: "dish", label: "High-Gain Antenna", color: 0xf1f5f9, desc: "A parabolic dish that focuses radio signals for high-bandwidth downlink to ground stations — needs to stay pointed at Earth." },
  { id: "whip", label: "Omni Antenna", color: 0xfbbf24, desc: "A low-gain antenna radiating in most directions — carries commands and telemetry even when the dish isn't aimed at a ground station." },
  { id: "tracker", label: "Star Tracker", color: 0xc026d3, desc: "An optical sensor that images star fields to work out the satellite's precise orientation (attitude) in space." },
  { id: "sensor", label: "Sensor Payload", color: 0x22d3ee, desc: "The instrument the mission is actually built around — a camera, a science instrument, or a comms payload, depending on the satellite." },
  { id: "thruster", label: "Thrusters", color: 0xf59e0b, desc: "Small rocket nozzles for station-keeping (staying in the right orbit) and a controlled deorbit burn at end of life." },
  { id: "radiator", label: "Radiator Panel", color: 0x0f172a, desc: "A passive cooling surface that radiates waste heat from onboard electronics out into space." },
  { id: "boom", label: "Magnetometer Boom", color: 0x94a3b8, desc: "A deployable arm that holds a magnetic-field sensor away from the bus — far enough that the spacecraft's own electronics don't pollute the reading." },
];

function makeGridTexture(base: string, line: string, cells: number): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.5;
  const step = size / cells;
  for (let i = 0; i <= cells; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * step);
    ctx.lineTo(size, i * step);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// MLI (multi-layer insulation) gold-foil look — the crinkled gold/copper
// wrapping visible on most real spacecraft avionics boxes. Random creased
// streaks over a base gold, not meant to be a precise material sim.
function makeFoilTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#8a6a1f";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    const x1 = Math.random() * size, y1 = Math.random() * size;
    const len = 10 + Math.random() * 30;
    const angle = Math.random() * Math.PI;
    ctx.strokeStyle = Math.random() > 0.5 ? "rgba(255,223,120,0.35)" : "rgba(90,60,10,0.35)";
    ctx.lineWidth = 1 + Math.random();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + Math.cos(angle) * len, y1 + Math.sin(angle) * len);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

type BuiltPart = {
  id: string;
  object: THREE.Object3D;
  materials: THREE.MeshStandardMaterial[];
  baseColors: THREE.Color[];
  baseEmissiveIntensity: number[];
};

function buildModel(): { group: THREE.Group; parts: BuiltPart[]; dispose: () => void } {
  const group = new THREE.Group();
  const parts: BuiltPart[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const textures: THREE.Texture[] = [];

  function register(id: string, object: THREE.Object3D, mats: THREE.MeshStandardMaterial[]) {
    parts.push({
      id,
      object,
      materials: mats,
      baseColors: mats.map((m) => m.color.clone()),
      baseEmissiveIntensity: mats.map((m) => m.emissiveIntensity),
    });
    group.add(object);
  }

  // Main bus — brushed-metal look via metalness/roughness under real lights
  // (see the light rig in setupScene), plus a gold-foil-wrapped avionics
  // box greeble on top (the crinkled-MLI look real spacecraft have) so it
  // doesn't read as a plain primitive box.
  const busGeo = new THREE.BoxGeometry(0.55, 0.55, 0.8);
  geometries.push(busGeo);
  const busMat = new THREE.MeshStandardMaterial({ color: PARTS[0].color, metalness: 0.6, roughness: 0.35 });
  const bus = new THREE.Mesh(busGeo, busMat);
  const busEdges = new THREE.LineSegments(new THREE.EdgesGeometry(busGeo), new THREE.LineBasicMaterial({ color: 0x475569 }));
  bus.add(busEdges);

  const foilTex = makeFoilTexture();
  textures.push(foilTex);
  const avionicsGeo = new THREE.BoxGeometry(0.32, 0.14, 0.42);
  geometries.push(avionicsGeo);
  const avionicsMat = new THREE.MeshStandardMaterial({ map: foilTex, color: 0xd4af37, metalness: 0.55, roughness: 0.5 });
  const avionics = new THREE.Mesh(avionicsGeo, avionicsMat);
  avionics.position.set(0, 0.345, -0.1);
  bus.add(avionics);
  register("bus", bus, [busMat, avionicsMat]);

  // Solar arrays — two wings, each split into two hinged segments (small
  // gap + a hinge cylinder between them) rather than one flat plank, plus
  // a denser cell grid — the deployable-panel look real arrays have.
  const solarTex = makeGridTexture("#1d4ed8", "#60a5fa", 10);
  textures.push(solarTex);
  const segGeo = new THREE.BoxGeometry(0.72, 0.03, 0.6);
  geometries.push(segGeo);
  const panelMat = new THREE.MeshStandardMaterial({ map: solarTex, color: PARTS[1].color, metalness: 0.3, roughness: 0.25 });
  const armGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.25, 12);
  geometries.push(armGeo);
  const armMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.7, roughness: 0.4 });
  const hingeGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.62, 10);
  geometries.push(hingeGeo);
  const hingeMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.3 });

  const solarGroup = new THREE.Group();
  [-1, 1].forEach((side) => {
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.rotation.z = Math.PI / 2;
    arm.position.x = side * 0.4;
    const segInner = new THREE.Mesh(segGeo, panelMat);
    segInner.position.x = side * 0.78;
    const hinge = new THREE.Mesh(hingeGeo, hingeMat);
    hinge.rotation.x = Math.PI / 2;
    hinge.position.x = side * 1.15;
    const segOuter = new THREE.Mesh(segGeo, panelMat);
    segOuter.position.x = side * 1.52;
    solarGroup.add(arm, segInner, hinge, segOuter);
  });
  register("solar", solarGroup, [panelMat, hingeMat]);

  // High-gain dish (a shallow lathe-revolved parabola) + feed horn
  const dishPts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    dishPts.push(new THREE.Vector2(t * 0.32, t * t * 0.22));
  }
  const dishGeo = new THREE.LatheGeometry(dishPts, 32);
  geometries.push(dishGeo);
  const dishMat = new THREE.MeshStandardMaterial({ color: PARTS[2].color, side: THREE.DoubleSide, metalness: 0.2, roughness: 0.5 });
  const dish = new THREE.Mesh(dishGeo, dishMat);
  dish.rotation.x = Math.PI;
  const dishGroup = new THREE.Group();
  dishGroup.add(dish);
  const hornGeo = new THREE.ConeGeometry(0.025, 0.14, 8);
  geometries.push(hornGeo);
  const hornMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.5, roughness: 0.4 });
  const horn = new THREE.Mesh(hornGeo, hornMat);
  horn.position.z = -0.18;
  horn.rotation.x = Math.PI / 2;
  dishGroup.add(horn);
  dishGroup.position.set(0, 0.42, 0.15);
  dishGroup.rotation.x = -0.3;
  register("dish", dishGroup, [dishMat, hornMat]);

  // Omni whip antenna
  const whipGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.5, 12);
  geometries.push(whipGeo);
  const whipMat = new THREE.MeshStandardMaterial({ color: PARTS[3].color, metalness: 0.8, roughness: 0.3 });
  const whip = new THREE.Mesh(whipGeo, whipMat);
  whip.position.set(0.15, 0, -0.62);
  whip.rotation.x = Math.PI / 2.4;
  register("whip", whip, [whipMat]);

  // Star tracker (small boxy sensor with a lens)
  const trackerGeo = new THREE.BoxGeometry(0.1, 0.1, 0.14);
  geometries.push(trackerGeo);
  const trackerMat = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.4, roughness: 0.6 });
  const tracker = new THREE.Mesh(trackerGeo, trackerMat);
  const lensGeo = new THREE.CircleGeometry(0.035, 16);
  geometries.push(lensGeo);
  const lensMat = new THREE.MeshStandardMaterial({ color: PARTS[4].color, emissive: PARTS[4].color, emissiveIntensity: 0.6, roughness: 0.3 });
  const lens = new THREE.Mesh(lensGeo, lensMat);
  lens.position.z = 0.071;
  tracker.add(lens);
  tracker.position.set(-0.2, 0.32, -0.1);
  register("tracker", tracker, [trackerMat, lensMat]);

  // Sensor payload (camera aperture on the front face)
  const bezelGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.05, 24);
  geometries.push(bezelGeo);
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x0b0914, metalness: 0.5, roughness: 0.5 });
  const bezel = new THREE.Mesh(bezelGeo, bezelMat);
  bezel.rotation.x = Math.PI / 2;
  const apertureGeo = new THREE.CircleGeometry(0.09, 24);
  geometries.push(apertureGeo);
  const apertureMat = new THREE.MeshStandardMaterial({ color: PARTS[5].color, emissive: PARTS[5].color, emissiveIntensity: 0.7, roughness: 0.2 });
  const aperture = new THREE.Mesh(apertureGeo, apertureMat);
  aperture.position.z = 0.026;
  bezel.add(aperture);
  bezel.position.set(0, -0.1, 0.41);
  register("sensor", bezel, [bezelMat, apertureMat]);

  // Thrusters (rear nozzles)
  const nozzleGeo = new THREE.ConeGeometry(0.055, 0.13, 12);
  geometries.push(nozzleGeo);
  const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.75, roughness: 0.35 });
  const tipMat = new THREE.MeshStandardMaterial({ color: PARTS[6].color, emissive: PARTS[6].color, emissiveIntensity: 0.8, roughness: 0.3 });
  const thrusterGroup = new THREE.Group();
  [-0.18, 0.18].forEach((x) => {
    const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
    nozzle.rotation.x = -Math.PI / 2;
    nozzle.position.set(x, -0.18, -0.46);
    const tipGeo = new THREE.CircleGeometry(0.02, 12);
    geometries.push(tipGeo);
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.z = -0.065;
    tip.rotation.x = Math.PI;
    nozzle.add(tip);
    thrusterGroup.add(nozzle);
  });
  register("thruster", thrusterGroup, [nozzleMat, tipMat]);

  // Radiator panel (flat panel on the belly, opposite the sensor face)
  const radTex = makeGridTexture("#0f172a", "#334155", 1);
  textures.push(radTex);
  const radGeo = new THREE.BoxGeometry(0.4, 0.02, 0.55);
  geometries.push(radGeo);
  const radMat = new THREE.MeshStandardMaterial({ map: radTex, color: PARTS[7].color, metalness: 0.3, roughness: 0.6 });
  const radiator = new THREE.Mesh(radGeo, radMat);
  radiator.position.set(0, 0.29, -0.02);
  register("radiator", radiator, [radMat]);

  // Magnetometer boom — a thin deployable rod with a small sensor sphere
  // at the tip, angled away from the bus and the solar-array axis so it
  // reads as its own distinct silhouette element.
  const boomGroup = new THREE.Group();
  const boomRodGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.62, 10);
  geometries.push(boomRodGeo);
  const boomRodMat = new THREE.MeshStandardMaterial({ color: PARTS[8].color, metalness: 0.6, roughness: 0.35 });
  const boomRod = new THREE.Mesh(boomRodGeo, boomRodMat);
  boomRod.position.set(0, 0, 0.31);
  boomGroup.add(boomRod);
  const boomTipGeo = new THREE.SphereGeometry(0.035, 16, 16);
  geometries.push(boomTipGeo);
  const boomTipMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.3, roughness: 0.5 });
  const boomTip = new THREE.Mesh(boomTipGeo, boomTipMat);
  boomTip.position.set(0, 0, 0.62);
  boomGroup.add(boomTip);
  boomGroup.position.set(-0.24, -0.1, 0.42);
  boomGroup.rotation.x = -0.5;
  boomGroup.rotation.y = 0.6;
  register("boom", boomGroup, [boomRodMat, boomTipMat]);

  function dispose() {
    geometries.forEach((g) => g.dispose());
    textures.forEach((t) => t.dispose());
    parts.forEach((p) => p.materials.forEach((m) => m.dispose()));
  }

  return { group, parts, dispose };
}

type SceneHandle = {
  setActive: (id: string | null) => void;
  resetView: () => void;
  dispose: () => void;
};

function setupScene(
  mount: HTMLDivElement,
  onPick: (id: string | null) => void
): SceneHandle {
  const width = mount.clientWidth;
  const height = mount.clientHeight;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 50);
  const DEFAULT_CAM = new THREE.Vector3(1.6, 1.1, 2.4);
  camera.position.copy(DEFAULT_CAM);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  mount.appendChild(renderer.domElement);

  const rig = new THREE.Group();
  scene.add(rig);
  const { group: model, parts, dispose: disposeModel } = buildModel();
  rig.add(model);

  // Three-point-ish light rig — the model now uses MeshStandardMaterial,
  // so it needs real lights or it renders flat black. Warm key + cool fill
  // + a colored rim light for a less "naive default cube" look.
  const ambient = new THREE.AmbientLight(0x334155, 0.9);
  scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xfff4e0, 1.6);
  keyLight.position.set(2, 2.5, 3);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x60a5fa, 0.5);
  fillLight.position.set(-2.5, -1, 1.5);
  scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight(0x34d399, 0.9);
  rimLight.position.set(-1.5, 1.5, -3);
  scene.add(rimLight);

  // Soft studio-style backdrop glow rings, purely staging (no data).
  const ringGeo = new THREE.RingGeometry(1.3, 1.32, 64);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);

  const starGeo = new THREE.BufferGeometry();
  const starCount = 260;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    starPos[i * 3] = (Math.random() - 0.5) * 14;
    starPos[i * 3 + 1] = (Math.random() - 0.5) * 14;
    starPos[i * 3 + 2] = (Math.random() - 0.5) * 14 - 3;
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0x93c5fd, size: 0.02, transparent: true, opacity: 0.5 });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  let isDragging = false;
  let dragDistance = 0;
  let prevX = 0, prevY = 0;
  const AUTO_VEL_Y = 0.004;
  let velY = AUTO_VEL_Y;
  let velX = 0;
  let autoRotate = true;
  let lastInteraction = 0;
  const IDLE_RESUME_MS = 2800;

  function onDown(e: PointerEvent) {
    isDragging = true;
    dragDistance = 0;
    prevX = e.clientX;
    prevY = e.clientY;
    autoRotate = false;
    velY = 0;
    velX = 0;
  }
  function onMove(e: PointerEvent) {
    if (!isDragging) return;
    const dx = e.clientX - prevX, dy = e.clientY - prevY;
    dragDistance += Math.abs(dx) + Math.abs(dy);
    rig.rotation.y += dx * 0.008;
    rig.rotation.x = Math.max(-1, Math.min(1, rig.rotation.x + dy * 0.008));
    // Track velocity so release can carry momentum instead of stopping dead.
    velY = dx * 0.0025;
    velX = dy * 0.0025;
    prevX = e.clientX; prevY = e.clientY;
    lastInteraction = Date.now();
  }
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  function pickAt(clientX: number, clientY: number): string | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    for (const part of parts) {
      const hit = raycaster.intersectObject(part.object, true);
      if (hit.length > 0) return part.id;
    }
    return null;
  }
  function onUp(e: PointerEvent) {
    isDragging = false;
    lastInteraction = Date.now();
    if (dragDistance >= 4) return;
    velY = 0;
    velX = 0;
    onPick(pickAt(e.clientX, e.clientY));
  }
  function onLeave() {
    renderer.domElement.style.cursor = "grab";
  }
  function onHover(e: PointerEvent) {
    if (isDragging) return;
    const id = pickAt(e.clientX, e.clientY);
    renderer.domElement.style.cursor = id ? "pointer" : "grab";
  }
  renderer.domElement.style.cursor = "grab";
  renderer.domElement.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  renderer.domElement.addEventListener("pointermove", onHover);
  renderer.domElement.addEventListener("pointerleave", onLeave);

  let activeId: string | null = null;
  const pulse = { t: 0 };

  function setActive(id: string | null) {
    activeId = id;
  }

  function resetView() {
    rig.rotation.set(0, 0, 0);
    autoRotate = true;
  }

  let raf: number;
  let stopped = false;
  let bobT = 0;
  function animate() {
    if (stopped) return;
    raf = requestAnimationFrame(animate);

    if (!isDragging) {
      // Momentum: whatever velocity a drag release left behind keeps
      // spinning the model and decays smoothly, instead of stopping dead —
      // then, after a couple of idle seconds, ease back into auto-rotate.
      rig.rotation.y += velY;
      rig.rotation.x = Math.max(-1, Math.min(1, rig.rotation.x + velX));
      velY *= 0.94;
      velX *= 0.94;
      if (!autoRotate && Date.now() - lastInteraction > IDLE_RESUME_MS) {
        autoRotate = true;
        velY = AUTO_VEL_Y;
        velX = 0;
      }
      if (autoRotate && Math.abs(velY) < AUTO_VEL_Y) velY = AUTO_VEL_Y;
    }
    bobT += 0.02;
    model.position.y = Math.sin(bobT) * 0.035;
    ring.rotation.z += 0.002;

    pulse.t += 0.08;
    const glow = 0.55 + Math.sin(pulse.t) * 0.45;
    for (const part of parts) {
      const isActive = part.id === activeId;
      part.object.scale.setScalar(isActive ? 1.06 : 1);
      part.materials.forEach((m, i) => {
        const baseEmissiveIntensity = part.baseEmissiveIntensity[i];
        if (isActive) {
          m.color.copy(part.baseColors[i]).lerp(new THREE.Color(0xffffff), 0.25 + glow * 0.25);
          m.emissiveIntensity = baseEmissiveIntensity + glow * 0.6;
        } else {
          m.color.copy(part.baseColors[i]);
          m.emissiveIntensity = baseEmissiveIntensity;
        }
      });
    }

    renderer.render(scene, camera);
  }
  animate();

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
    renderer.domElement.removeEventListener("pointermove", onHover);
    renderer.domElement.removeEventListener("pointerleave", onLeave);
    disposeModel();
    ringGeo.dispose();
    ringMat.dispose();
    starGeo.dispose();
    starMat.dispose();
    renderer.dispose();
    if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
  }

  return { setActive, resetView, dispose };
}

export default function SatelliteInspector() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const [webglReady, setWebglReady] = useState<boolean | null>(null);
  const [activePart, setActivePart] = useState<string | null>(null);

  useEffect(() => {
    setWebglReady(isWebglAvailable());
  }, []);

  useEffect(() => {
    if (webglReady !== true) return;
    const mount = mountRef.current;
    if (!mount) return;
    try {
      sceneRef.current = setupScene(mount, (id) => setActivePart(id));
    } catch {
      setWebglReady(false);
      return;
    }
    return () => sceneRef.current?.dispose();
  }, [webglReady]);

  useEffect(() => {
    sceneRef.current?.setActive(activePart);
  }, [activePart]);

  const active = PARTS.find((p) => p.id === activePart) ?? null;

  return (
    <div className="glass-panel p-4 flex flex-col h-full">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-accent" />
          <HudChip color="mint">SATELLITE ANATOMY</HudChip>
        </div>
        <button
          onClick={() => { sceneRef.current?.resetView(); setActivePart(null); }}
          className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          <RotateCcw className="h-3 w-3" /> reset
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 flex-1 min-h-0">
        <div className="sm:col-span-3 relative rounded-lg border border-border/60 overflow-hidden min-h-[280px]">
          {webglReady === true && <div ref={mountRef} className="absolute inset-0" />}
          {webglReady === false && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500 text-center px-6">
              3D rendering unavailable on this device.
            </div>
          )}
          <div className="absolute top-2 left-2 rounded-lg border border-border/60 bg-[#0d0a18]/70 backdrop-blur-sm px-2.5 py-1.5 text-[9px] hud-text text-slate-500">
            GENERIC MODEL · ILLUSTRATIVE · DRAG TO ROTATE · CLICK A PART
          </div>
        </div>

        <div className="sm:col-span-2 flex flex-col min-h-0">
          <div className="space-y-1 overflow-y-auto">
            {PARTS.map((p) => (
              <button
                key={p.id}
                onClick={() => setActivePart(p.id === activePart ? null : p.id)}
                className={`w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md text-xs transition-colors border ${
                  activePart === p.id
                    ? "bg-accent/15 border-accent/50 text-slate-100"
                    : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-panel/60"
                }`}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: `#${p.color.toString(16).padStart(6, "0")}` }}
                />
                {p.label}
              </button>
            ))}
          </div>

          <div className="mt-2 flex-1 rounded-lg bg-[#0d0a18] border border-border/60 p-3 min-h-[110px]">
            {active ? (
              <>
                <p className="text-xs font-semibold text-accent-glow mb-1">{active.label}</p>
                <p className="text-[11px] text-slate-400 leading-relaxed">{active.desc}</p>
              </>
            ) : (
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Click any highlighted part on the model — or a name on the left — to see what it does.
              </p>
            )}
          </div>
        </div>
      </div>

      <p className="text-[10px] text-slate-600 mt-2 text-center">
        Generic satellite anatomy for orientation — not a scan of the specific object tracked to the left; real designs vary by mission.
      </p>
    </div>
  );
}
