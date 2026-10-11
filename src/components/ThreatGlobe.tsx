"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Loader2, Orbit, Maximize2, Minimize2 } from "lucide-react";
import { fetchGlobeStats, GlobeStats } from "@/lib/threatGlobeData";
import { isWebglAvailable } from "@/lib/webglSupport";
import { makeCometHeadTexture, makeCometWispTexture, TAIL_ANCHOR_U, TAIL_ANCHOR_V } from "@/lib/cometSprite";
import { useMaximizePanel } from "@/lib/useMaximizePanel";
import ThreatGlobeFallback from "@/components/ThreatGlobeFallback";
import ThreatNeuralView from "@/components/ThreatNeuralView";
import HudChip from "@/components/HudChip";

const CLUSTERS = [
  { color: 0xdc2626, label: "CRITICAL", center: new THREE.Vector3(1, 0.6, 0.4) },
  { color: 0xf59e0b, label: "HIGH", center: new THREE.Vector3(-0.8, 0.5, -0.6) },
  { color: 0x9333ea, label: "KEV-LISTED", center: new THREE.Vector3(0.3, -0.9, 0.5) },
  { color: 0x22d3ee, label: "MONITORED", center: new THREE.Vector3(-0.5, -0.4, -0.9) },
  { color: 0x10b981, label: "BASELINE", center: new THREE.Vector3(0.7, -0.1, -0.8) },
  { color: 0xf472b6, label: "RANSOMWARE", center: new THREE.Vector3(-0.9, 0.7, 0.3) },
  { color: 0xfacc15, label: "EXPOSED", center: new THREE.Vector3(0.2, 0.9, -0.4) },
];

function makeGlowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.3, "rgba(255,255,255,0.7)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// Radiating spokes of light behind the core, like a halo/sunburst — each
// ray is its own radial-gradient wedge so the gaps between rays stay
// genuinely transparent instead of a flat ring.
function makeSunburstTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;
  const cy = size / 2;
  const rayCount = 16;
  for (let i = 0; i < rayCount; i++) {
    const angle = (i / rayCount) * Math.PI * 2;
    const width = (i % 2 === 0 ? 0.1 : 0.05) * Math.PI * 2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
    grad.addColorStop(0, "rgba(255,255,255,0.9)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.22)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, size / 2, angle - width / 2, angle + width / 2);
    ctx.closePath();
    ctx.fill();
  }
  return new THREE.CanvasTexture(canvas);
}

type CometLabel = { title: string; sub: string; color: string };

function buildCometLabels(stats: GlobeStats | null): CometLabel[] {
  const labels: CometLabel[] = [];
  if (stats) {
    for (const k of stats.kevList.slice(0, 8)) {
      labels.push({ title: k.id, sub: k.product, color: k.ransomware ? "#f472b6" : "#9333ea" });
    }
    for (const c of stats.cveList.slice(0, 6)) {
      if (c.score === null) continue;
      labels.push({ title: c.id, sub: `CVSS ${c.score}`, color: c.score >= 9 ? "#dc2626" : "#f59e0b" });
    }
  }
  while (labels.length < 12) {
    labels.push({ title: "SCANNING", sub: "live feed", color: "#22d3ee" });
  }
  return labels.slice(0, 12);
}

/**
 * All Three.js/WebGL setup lives in this plain function (not inline in
 * the effect) so it can be wrapped in try/catch from the caller — any
 * failure here (restricted WebGL, driver issue, context loss) triggers
 * a graceful fallback instead of leaving the page stuck.
 */
function setupThreeScene(mount: HTMLDivElement, cometLabels: CometLabel[]): () => void {
  const width = mount.clientWidth;
  const height = mount.clientHeight;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 100);
  camera.position.z = 5.2;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  mount.appendChild(renderer.domElement);

  const glowTexture = makeGlowTexture();
  const cometHeadTexture = makeCometHeadTexture();
  // Three differently-wavy strand textures, shared across every comet —
  // layering a few of these per comet (each animated independently) is
  // what makes the tail read as a loose, flowing bundle of light rather
  // than one rigid wedge.
  const cometWispTextures = [makeCometWispTexture(0), makeCometWispTexture(2.3), makeCometWispTexture(4.6)];

  const starGeo = new THREE.BufferGeometry();
  const starCount = 900;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    starPositions[i * 3] = (Math.random() - 0.5) * 40;
    starPositions[i * 3 + 1] = (Math.random() - 0.5) * 40;
    starPositions[i * 3 + 2] = (Math.random() - 0.5) * 40 - 5;
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  const starMat = new THREE.PointsMaterial({ size: 0.05, color: 0xffffff, map: glowTexture, transparent: true, opacity: 0.6, depthWrite: false });
  scene.add(new THREE.Points(starGeo, starMat));

  const globeGroup = new THREE.Group();
  scene.add(globeGroup);

  // Denser and larger than before — this is meant to read as a packed
  // nebula/data-storm, not a sparse point cloud. Colors stay exactly the
  // real severity mapping (see caption below the scene) — only the
  // decorative core/ring/comets get the animated color drift further
  // down, so nothing that encodes real data ever visually lies.
  const particleCount = 9000;
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < particleCount; i++) {
    const cluster = CLUSTERS[i % CLUSTERS.length];
    const dir = cluster.center.clone().normalize();
    const jitter = new THREE.Vector3(
      dir.x + (Math.random() - 0.5) * 1.1,
      dir.y + (Math.random() - 0.5) * 1.1,
      dir.z + (Math.random() - 0.5) * 1.1
    ).normalize();
    const radius = 1.5 + Math.random() * Math.random() * 1.9;
    positions[i * 3] = jitter.x * radius;
    positions[i * 3 + 1] = jitter.y * radius;
    positions[i * 3 + 2] = jitter.z * radius;

    tmpColor.set(cluster.color);
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.06,
    vertexColors: true,
    map: glowTexture,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  globeGroup.add(points);

  // Constellation lines: connect each particle to its nearest neighbors
  // within the same cluster — this is what turns a static point-cloud into
  // something that reads as an active, "thinking" network.
  const linePositions: number[] = [];
  const lineColors: number[] = [];
  const maxLinksPerPoint = 3;
  const maxLinkDist = 0.5;
  for (let i = 0; i < particleCount; i += 4) {
    let links = 0;
    for (let j = 0; j < particleCount && links < maxLinksPerPoint; j += 5) {
      if (i === j) continue;
      const dx = positions[i * 3] - positions[j * 3];
      const dy = positions[i * 3 + 1] - positions[j * 3 + 1];
      const dz = positions[i * 3 + 2] - positions[j * 3 + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < maxLinkDist) {
        linePositions.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        linePositions.push(positions[j * 3], positions[j * 3 + 1], positions[j * 3 + 2]);
        lineColors.push(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]);
        lineColors.push(colors[j * 3], colors[j * 3 + 1], colors[j * 3 + 2]);
        links++;
      }
    }
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  lineGeo.setAttribute("color", new THREE.Float32BufferAttribute(lineColors, 3));
  const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending });
  const constellationLines = new THREE.LineSegments(lineGeo, lineMat);
  globeGroup.add(constellationLines);

  // A big soft halo well outside the core — this is what makes the core
  // read as an actual light source washing over the surrounding storm,
  // not just a bright dot sitting in front of it. Additive blending so
  // it genuinely brightens whatever's behind it. Pulses like a heartbeat
  // (sharp rise, slower decay) rather than a gentle sine breathing.
  const coreHaloMat = new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xbdf7d8,
    transparent: true,
    opacity: 0.09,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const coreHalo = new THREE.Sprite(coreHaloMat);
  coreHalo.scale.set(2.0, 2.0, 1);
  globeGroup.add(coreHalo);

  // Radiating sunburst spokes behind the core — a "sacred halo" look,
  // slowly rotating, additive so it reads as light rays rather than a
  // flat decal.
  const sunburstMat = new THREE.SpriteMaterial({
    map: makeSunburstTexture(),
    color: 0xfffbe8,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sunburst = new THREE.Sprite(sunburstMat);
  sunburst.scale.set(2.6, 2.6, 1);
  globeGroup.add(sunburst);

  // Bright pulsing core — a soft double-blob bloom at dead center, the
  // "planet" the whole storm orbits. Enlarged and pulses harder than
  // before, now that the ring around it is gone and the core itself is
  // the whole focal point.
  const coreMat = new THREE.SpriteMaterial({ map: glowTexture, color: 0x8affc7, transparent: true, opacity: 0.95, depthWrite: false });
  const core = new THREE.Sprite(coreMat);
  core.scale.set(1.55, 1.55, 1);
  globeGroup.add(core);
  const coreMat2 = new THREE.SpriteMaterial({ map: glowTexture, color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
  const coreInner = new THREE.Sprite(coreMat2);
  coreInner.scale.set(0.7, 0.7, 1);
  globeGroup.add(coreInner);

  // Two slow orbital rings — the "satellite belt" / futuristic-tech touch.
  const ring1Geo = new THREE.TorusGeometry(2.3, 0.006, 8, 128);
  const ring1Mat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.35 });
  const ring1 = new THREE.Mesh(ring1Geo, ring1Mat);
  ring1.rotation.x = Math.PI / 2.4;
  globeGroup.add(ring1);

  const ring2Geo = new THREE.TorusGeometry(2.7, 0.005, 8, 128);
  const ring2Mat = new THREE.MeshBasicMaterial({ color: 0xE11D48, transparent: true, opacity: 0.25 });
  const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
  ring2.rotation.x = Math.PI / 1.7;
  ring2.rotation.y = Math.PI / 5;
  globeGroup.add(ring2);

  // Big "comet" stars — the first `labeledCount` hold a real KEV/CVE entry
  // (HTML label + SVG leader line, updated every frame from projected
  // screen position); the rest are purely decorative filler that add the
  // reference video's density without needing more real catalog data to
  // label. Every comet's tail direction (SpriteMaterial.rotation) is
  // recomputed every frame from its actual on-screen velocity plus a small
  // sinusoidal sway, so it reads as something alive swinging through space
  // instead of a fixed-angle static glow/spotlight.
  const labeledCount = cometLabels.length;
  const decorativeCometCount = 14;
  const cometCount = labeledCount + decorativeCometCount;
  const WISPS_PER_COMET = 3;
  const comets: {
    head: THREE.Sprite;
    wisps: THREE.Sprite[];
    baseRadius: number;
    angle: number;
    axis: THREE.Vector3;
    speed: number;
    baseScale: number;
    tailAngle: number;
    prevSx: number | null;
    prevSy: number | null;
    wobbleSeed: number;
    wispSeeds: number[];
  }[] = [];
  for (let i = 0; i < cometCount; i++) {
    const isLabeled = i < labeledCount;
    const scale = isLabeled ? 0.4 + Math.random() * 0.35 : 0.18 + Math.random() * 0.22;

    // Head: symmetric glow dot, always reads as a clean round star no
    // matter how it's rotated.
    const headMat = new THREE.SpriteMaterial({ map: cometHeadTexture, color: 0xffffff, transparent: true, depthWrite: false });
    const head = new THREE.Sprite(headMat);
    head.scale.set(scale, scale, 1);
    globeGroup.add(head);

    // Tail: several wavy strands, each pivoted at its bright anchor edge
    // (Sprite.center) so they all sweep out from the head as rotation
    // tracks travel direction, each swaying on its own independent phase
    // — a loose flowing bundle, not one rigid wedge.
    const wisps: THREE.Sprite[] = [];
    for (let w = 0; w < WISPS_PER_COMET; w++) {
      const wispMat = new THREE.SpriteMaterial({
        map: cometWispTextures[w % cometWispTextures.length],
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
      });
      const wisp = new THREE.Sprite(wispMat);
      wisp.center.set(TAIL_ANCHOR_U, TAIL_ANCHOR_V);
      wisp.scale.set(scale * 2.4, scale * 0.5, 1);
      globeGroup.add(wisp);
      wisps.push(wisp);
    }

    comets.push({
      head,
      wisps,
      baseRadius: 2.2 + Math.random() * 1.3,
      angle: Math.random() * Math.PI * 2,
      axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      speed: 0.0025 + Math.random() * 0.003,
      baseScale: scale,
      tailAngle: Math.random() * Math.PI * 2,
      prevSx: null,
      prevSy: null,
      wobbleSeed: Math.random() * Math.PI * 2,
      wispSeeds: Array.from({ length: WISPS_PER_COMET }, () => Math.random() * Math.PI * 2),
    });
  }

  // HTML label + SVG leader-line overlay for the comets.
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
  mount.appendChild(overlay);

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.style.cssText = "position:absolute;inset:0;";
  overlay.appendChild(svg);

  const labelEls = cometLabels.map((label, i) => {
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("stroke", label.color);
    line.setAttribute("stroke-opacity", "0.45");
    line.setAttribute("stroke-width", "1");
    svg.appendChild(line);

    const el = document.createElement("div");
    el.className =
      "absolute -translate-y-1/2 whitespace-nowrap rounded border bg-panel/85 backdrop-blur-sm px-1.5 py-0.5 text-[9px] leading-tight hud-text";
    el.style.borderColor = `${label.color}80`;
    // title/sub come from KEV/CVE feeds (lib/kevCve data) — external,
    // not under this app's control. textContent, not innerHTML, so
    // nothing in those fields can ever be parsed as markup.
    const titleSpan = document.createElement("span");
    titleSpan.style.color = label.color;
    titleSpan.textContent = label.title;
    const subSpan = document.createElement("span");
    subSpan.className = "text-slate-500";
    subSpan.textContent = ` ${label.sub}`;
    el.append(titleSpan, subSpan);
    overlay.appendChild(el);
    return { line, el, side: i % 2 === 0 ? 1 : -1 };
  });

  let isDragging = false;
  let prevX = 0;
  let prevY = 0;
  let rotationVelocity = { x: 0, y: 0.0025 };

  function onPointerDown(e: PointerEvent) {
    isDragging = true;
    prevX = e.clientX;
    prevY = e.clientY;
  }
  function onPointerMove(e: PointerEvent) {
    if (!isDragging) return;
    const dx = e.clientX - prevX;
    const dy = e.clientY - prevY;
    globeGroup.rotation.y += dx * 0.005;
    globeGroup.rotation.x += dy * 0.005;
    rotationVelocity = { x: dy * 0.0003, y: dx * 0.0003 };
    prevX = e.clientX;
    prevY = e.clientY;
  }
  function onPointerUp() {
    isDragging = false;
  }
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);

  let raf: number;
  let stopped = false;
  const clock = new THREE.Clock();
  const projected = new THREE.Vector3();

  function animate() {
    if (stopped) return;
    raf = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    if (!isDragging) {
      globeGroup.rotation.y += rotationVelocity.y;
      globeGroup.rotation.x += rotationVelocity.x;
      rotationVelocity.x *= 0.98;
      rotationVelocity.y += (0.0025 - rotationVelocity.y) * 0.01;
    }
    // Slow tilt/sway on top of the base spin, plus a gentle camera drift —
    // this is what gives the reference video its handheld, alive feel
    // instead of a perfectly still orbit.
    globeGroup.rotation.z = Math.sin(t * 0.17) * 0.07;
    camera.position.x = Math.sin(t * 0.13) * 0.4;
    camera.position.y = Math.cos(t * 0.11) * 0.28;
    camera.lookAt(0, 0, 0);

    const pulse = 1 + Math.sin(t * 1.2) * 0.03;
    points.scale.setScalar(pulse);
    mat.opacity = 0.75 + Math.sin(t * 1.2) * 0.15;
    ring1.rotation.z += 0.0018;
    ring2.rotation.z -= 0.0012;
    sunburstMat.rotation += 0.0015;

    // Slow color drift on decorative-only elements (never the real
    // severity-coded particle colors) — the video's most recognizable
    // trait, its palette slowly cycling through the spectrum.
    const hue = (t * 0.025) % 1;
    coreMat.color.setHSL(hue, 0.55, 0.72);
    // "Holy halo" breathing in and out — kept modest so it never
    // overwhelms the frame.
    const corePulse = 1 + Math.sin(t * 1.6) * 0.25;
    core.scale.set(1.55 * corePulse, 1.55 * corePulse, 1);
    coreInner.scale.set(0.7 * corePulse, 0.7 * corePulse, 1);
    coreMat.opacity = 0.75 + Math.sin(t * 1.6) * 0.15;

    // Heartbeat-shaped pulse (sharp rise, slower decay) on the outer halo
    // — light "leaking out" locally around the core, not a giant flash
    // that washes out the whole particle storm. Scale/opacity capped
    // well within the particle cloud's own radius (~3.4 units).
    const heartbeat = Math.pow(Math.max(0, Math.sin(t * 0.85)), 2.4);
    coreHalo.scale.set(2.0 + heartbeat * 0.9, 2.0 + heartbeat * 0.9, 1);
    coreHaloMat.opacity = 0.08 + heartbeat * 0.14;
    coreHaloMat.color.setHSL(hue, 0.5, 0.78);
    sunburst.scale.set(2.6 + heartbeat * 0.7, 2.6 + heartbeat * 0.7, 1);
    sunburstMat.opacity = 0.12 + heartbeat * 0.09;

    comets.forEach((c, i) => {
      c.angle += c.speed;
      // Radius/lift both breathe slightly so orbits don't read as
      // perfectly circular — another source of the video's "life."
      const radiusPulse = c.baseRadius * (1 + Math.sin(t * 0.6 + c.wobbleSeed) * 0.06);
      const lift = Math.sin(c.angle * 0.7 + c.wobbleSeed) * 0.3;
      const pos = new THREE.Vector3(Math.cos(c.angle) * radiusPulse, lift, Math.sin(c.angle) * radiusPulse);
      pos.applyAxisAngle(c.axis, c.angle * 0.3);
      c.head.position.copy(pos);
      c.wisps.forEach((w) => w.position.copy(pos));
      const cometHue = (hue + i / comets.length) % 1;
      const headMat = c.head.material as THREE.SpriteMaterial;
      headMat.color.setHSL(cometHue, 0.7, 0.85);

      // Breathing scale pulse — the head stays a clean round dot (only
      // its size pulses).
      const scalePulse = 1 + Math.sin(t * 2.1 + c.wobbleSeed) * 0.2;
      c.head.scale.set(c.baseScale * scalePulse, c.baseScale * scalePulse, 1);

      const world = c.head.getWorldPosition(projected).clone();
      world.project(camera);
      const sx = ((world.x + 1) / 2) * width;
      const sy = ((1 - world.y) / 2) * height;
      const behind = world.z > 1;

      // Tail direction tracks actual on-screen travel, smoothed — this is
      // what makes it read as a shooting star sweeping behind a fixed
      // point instead of a static flashlight beam or a whole shape
      // spinning rigidly.
      if (c.prevSx !== null && c.prevSy !== null) {
        const dx = sx - c.prevSx;
        const dy = sy - c.prevSy;
        if (Math.hypot(dx, dy) > 0.3) {
          const targetAngle = Math.atan2(dy, dx);
          let diff = targetAngle - c.tailAngle;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          c.tailAngle += diff * 0.12;
        }
      }
      c.prevSx = sx;
      c.prevSy = sy;

      // Each wisp strand sways, pulses in length, and flickers in
      // opacity on its own independent phase — a loose flowing bundle of
      // light, not a single fixed shape.
      c.wisps.forEach((wisp, w) => {
        const seed = c.wispSeeds[w];
        const wispMat = wisp.material as THREE.SpriteMaterial;
        wispMat.color.setHSL((cometHue + w * 0.02) % 1, 0.7, 0.75);
        wispMat.rotation = c.tailAngle + Math.sin(t * (1.1 + w * 0.35) + seed) * 0.35;
        const lengthPulse = 1 + Math.sin(t * (1.2 + w * 0.4) + seed * 1.7) * 0.35;
        wispMat.opacity = 0.55 + Math.sin(t * (1.5 + w * 0.5) + seed * 2.1) * 0.35;
        wisp.scale.set(c.baseScale * (2.0 + w * 0.35) * lengthPulse, c.baseScale * (0.4 + w * 0.08) * scalePulse, 1);
      });

      if (i >= labelEls.length) return;
      const { line, el, side } = labelEls[i];
      if (behind || sx < -50 || sx > width + 50) {
        el.style.opacity = "0";
        line.setAttribute("stroke-opacity", "0");
        return;
      }
      const lx = Math.min(width - 10, Math.max(10, sx + side * 46));
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
    });

    renderer.render(scene, camera);
  }
  animate();

  function handleResize() {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener("resize", handleResize);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", handleResize);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    geo.dispose();
    mat.dispose();
    lineGeo.dispose();
    lineMat.dispose();
    starGeo.dispose();
    starMat.dispose();
    coreMat.dispose();
    coreMat2.dispose();
    coreHaloMat.dispose();
    sunburstMat.map?.dispose();
    sunburstMat.dispose();
    ring1Geo.dispose();
    ring1Mat.dispose();
    ring2Geo.dispose();
    ring2Mat.dispose();
    cometHeadTexture.dispose();
    cometWispTextures.forEach((tex) => tex.dispose());
    glowTexture.dispose();
    comets.forEach((c) => {
      (c.head.material as THREE.SpriteMaterial).dispose();
      c.wisps.forEach((w) => (w.material as THREE.SpriteMaterial).dispose());
    });
    renderer.dispose();
    if (overlay.parentElement === mount) mount.removeChild(overlay);
    if (renderer.domElement.parentElement === mount) {
      mount.removeChild(renderer.domElement);
    }
  };
}

export default function ThreatGlobe() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<GlobeStats | null>(null);
  const [webglReady, setWebglReady] = useState<boolean | null>(null);
  // Defaults to classic so nothing about the existing look changes for
  // anyone who doesn't opt in — the toggle below is the rollback path.
  const [view, setView] = useState<"classic" | "neural">("classic");
  const { maximized, toggleMaximized } = useMaximizePanel();

  useEffect(() => {
    fetchGlobeStats().then(setStats).catch(() => setStats(null));
  }, []);

  useEffect(() => {
    // Some corporate/locked-down machines disable or heavily restrict
    // WebGL for security reasons. Detect it up front instead of letting
    // Three.js fail (or run at a crawl) after the fact.
    setWebglReady(isWebglAvailable());
  }, []);

  useEffect(() => {
    // Only mounted in classic mode — switching to neural tears this scene
    // down via the cleanup below, and switching back re-creates it fresh.
    if (view !== "classic" || webglReady !== true || stats === null) return;
    const mount = mountRef.current;
    if (!mount) return;

    let cleanup = () => {};
    try {
      cleanup = setupThreeScene(mount, buildCometLabels(stats));
    } catch {
      setWebglReady(false);
    }
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webglReady, stats, view]);

  return (
    <div
      className={
        maximized
          ? "glass-panel !bg-[#05040a] p-4 flex flex-col overflow-hidden !fixed !inset-0 !z-50 rounded-none"
          : "glass-panel p-4 flex flex-col h-full relative overflow-hidden"
      }
    >
      <div className="flex items-center justify-between mb-2 relative z-10">
        <div className="flex items-center gap-2">
          <Orbit className="h-4 w-4 text-accent" />
          <HudChip color="red">THREAT GLOBE</HudChip>
        </div>
        <div className="flex items-center gap-3">
          {view === "classic" && webglReady && (
            <span className="text-[10px] text-slate-500 flex items-center gap-1">
              <Orbit className="h-3 w-3" /> drag to rotate
            </span>
          )}
          <div className="flex items-center rounded-md border border-border overflow-hidden text-[10px] font-mono">
            <button
              onClick={() => setView("classic")}
              className={`px-2 py-1 transition-colors ${
                view === "classic" ? "bg-accent/25 text-slate-100" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Classic
            </button>
            <button
              onClick={() => setView("neural")}
              className={`px-2 py-1 transition-colors ${
                view === "neural" ? "bg-accent/25 text-slate-100" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Neural
            </button>
          </div>
          <button
            onClick={toggleMaximized}
            className="text-slate-500 hover:text-accent-glow transition-colors"
            title={maximized ? "Exit fullscreen (Esc)" : "Fullscreen"}
          >
            {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-3 min-h-0">
        <div className={`lg:col-span-3 relative rounded-lg overflow-hidden ${maximized ? "h-full" : "min-h-[620px]"}`}>
        {view === "classic" && (
          <>
            {webglReady === true && stats !== null && <div ref={mountRef} className="absolute inset-0" />}
            {webglReady === false && <ThreatGlobeFallback />}
            {(!stats || webglReady === null) && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-5 w-5 text-accent animate-spin" />
              </div>
            )}
          </>
        )}

        {view === "neural" && (
          <>
            <ThreatNeuralView stats={stats} />
            {!stats && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-5 w-5 text-accent animate-spin" />
              </div>
            )}
          </>
        )}

        {stats && webglReady !== null && (
          <>
            <div className="absolute top-2 left-2 rounded-lg border border-red-700/50 bg-red-950/60 backdrop-blur-sm px-2.5 py-1.5 text-[10px] hud-text max-w-[150px]">
              <p className="text-red-300 font-bold">HIGHEST CVSS</p>
              <p className="text-slate-200 mt-0.5">
                {stats.highestCve ? `${stats.highestCve.id} — ${stats.highestCve.score}` : "N/A"}
              </p>
            </div>

            <div className="absolute top-2 right-2 rounded-lg border border-accent/40 bg-panel/80 backdrop-blur-sm px-2.5 py-1.5 text-[10px] hud-text max-w-[150px]">
              <p className="text-accent-glow font-bold">TOP TARGETED VENDOR</p>
              <p className="text-slate-200 mt-0.5">
                {stats.topVendor ? `${stats.topVendor.name} (${stats.topVendor.count})` : "N/A"}
              </p>
            </div>

            <div className="absolute bottom-2 left-2 rounded-lg border border-purple-700/50 bg-purple-950/50 backdrop-blur-sm px-2.5 py-1.5 text-[10px] hud-text max-w-[160px]">
              <p className="text-purple-300 font-bold">RANSOMWARE-LINKED KEV</p>
              <p className="text-slate-200 mt-0.5">{stats.ransomwareCount} of {stats.totalKev}</p>
            </div>

            <div className="absolute bottom-2 right-2 rounded-lg border border-terminal/50 bg-emerald-950/50 backdrop-blur-sm px-2.5 py-1.5 text-[10px] hud-text max-w-[170px]">
              <p className="text-terminal-bright font-bold">LATEST KEV ADDITION</p>
              <p className="text-slate-200 mt-0.5">
                {stats.latestKev ? `${stats.latestKev.id} — ${stats.latestKev.product}` : "N/A"}
              </p>
            </div>
          </>
        )}
        </div>

        <div className={`overflow-y-auto space-y-3 ${maximized ? "h-full" : "max-h-[620px]"}`}>
          <div>
            <p className="text-[10px] text-terminal uppercase tracking-wide mb-1 hud-text">
              CISA KEV Catalogue Stream · {stats?.kevList.length ?? 0} entries
            </p>
            <div className="space-y-0.5">
              {stats?.kevList.map((k) => (
                <div key={k.id} className="flex items-center justify-between text-[10px] font-mono px-1.5 py-0.5 odd:bg-[#0d0a18]/60 rounded gap-1">
                  <span className={k.ransomware ? "text-red-300" : "text-slate-300"}>{k.id}</span>
                  <span className="text-slate-500 truncate max-w-[110px]">{k.product}</span>
                  <span className="text-terminal-bright shrink-0">{k.dateAdded}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] text-terminal uppercase tracking-wide mb-1 hud-text">
              Critical CVE Stream · NVD · {stats?.cveList.length ?? 0} entries
            </p>
            <div className="space-y-0.5">
              {stats?.cveList.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-[10px] font-mono px-1.5 py-0.5 odd:bg-[#0d0a18]/60 rounded gap-1">
                  <span className="text-slate-300">{c.id}</span>
                  <span className="text-amber-300 shrink-0">{c.score !== null ? `CVSS ${c.score}` : "—"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="text-[10px] text-slate-600 mt-2 text-center">
        {view === "neural"
          ? "Neural view: each input node is a real KEV/CVE entry, hidden nodes are the same 7 severity clusters as classic mode, and the output node is a composite threat score computed from live CISA KEV + NVD data (40% ransomware-linked share, 30% highest CVSS seen, 30% critical share)."
          : webglReady === false
          ? "3D rendering unavailable on this device/browser — showing a lightweight fallback. Data below is still live."
          : "Particle clusters are visual, not geographic — colors encode real severity data from CISA KEV + NVD, fetched live. Labeled comets show real catalog entries."}
      </p>
    </div>
  );
}
