"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Loader2 } from "lucide-react";
import type { GenomeRegion } from "@/lib/fileGenome";
import { isWebglAvailable } from "@/lib/webglSupport";

function makeGlowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.6)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function entropyHsl(bits: number): THREE.Color {
  const hue = Math.max(0, 130 - (bits / 8) * 130);
  return new THREE.Color(`hsl(${hue}, 75%, 55%)`);
}

type Point3D = { region: GenomeRegion; pos: THREE.Vector3 };

/**
 * X = byte offset, Y = entropy, Z = real neighbor-density in entropy
 * space (GenomeRegion.density from lib/fileGenome.ts) — an actual
 * "landscape" built from three real, independently-measured axes, not
 * a decorative 3D scatter. Drag to rotate, wheel to zoom, hover/click
 * to select — selection is shared with every other visualization in
 * this tool via onSelect.
 */
export default function EntropyLandscape3D({
  regions,
  fileSize,
  selectedIndex,
  onSelect,
  onHover,
}: {
  regions: GenomeRegion[];
  fileSize: number;
  selectedIndex: number | null;
  onSelect: (i: number) => void;
  onHover: (i: number | null) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [webglReady, setWebglReady] = useState<boolean | null>(null);
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;

  useEffect(() => {
    setWebglReady(isWebglAvailable());
  }, []);

  useEffect(() => {
    if (webglReady !== true) return;
    const mountEl = mountRef.current;
    if (!mountEl || regions.length === 0) return;
    // Cast away null explicitly — TS doesn't carry the null-check above
    // into the nested handleResize() closure defined further down.
    const mount = mountEl as HTMLDivElement;

    const width = mount.clientWidth;
    const height = mount.clientHeight;
    if (width === 0 || height === 0) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    camera.position.set(0, 2.2, 8);
    camera.lookAt(0, 1, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    const glowTexture = makeGlowTexture();
    const maxDensity = Math.max(1, ...regions.map((r) => r.density));
    const maxSize = Math.max(1, ...regions.map((r) => r.endByte - r.startByte));

    const SPAN_X = 6;
    const SPAN_Y = 3.4;
    const SPAN_Z = 3;

    const points: Point3D[] = regions.map((region) => {
      const x = (region.startByte / Math.max(1, fileSize)) * SPAN_X - SPAN_X / 2;
      const y = (region.entropy / 8) * SPAN_Y;
      const z = (region.density / maxDensity) * SPAN_Z - SPAN_Z / 2;
      return { region, pos: new THREE.Vector3(x, y, z) };
    });

    // Ridge line through the points in file order — this is what makes
    // it read as a "landscape profile," not just a floating point cloud.
    const ridgeGeo = new THREE.BufferGeometry().setFromPoints(points.map((p) => p.pos));
    const ridgeMat = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.25 });
    const ridgeLine = new THREE.Line(ridgeGeo, ridgeMat);
    group.add(ridgeLine);

    // A faint ground grid for spatial reference (helps rotation/depth read correctly).
    const grid = new THREE.GridHelper(SPAN_X, 12, 0x334155, 0x1e293b);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.25;
    grid.position.y = -0.02;
    group.add(grid);

    const sprites: THREE.Sprite[] = points.map(({ region, pos }) => {
      const size = region.endByte - region.startByte;
      const scale = 0.12 + Math.sqrt(size / maxSize) * 0.22;
      const mat = new THREE.SpriteMaterial({ map: glowTexture, color: entropyHsl(region.entropy), transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(pos);
      sprite.scale.set(scale, scale, 1);
      group.add(sprite);
      return sprite;
    });

    let isDragging = false;
    let dragDistance = 0;
    let prevX = 0;
    let prevY = 0;
    let rotationVelocity = { x: 0, y: 0.0016 };
    const mouseNdc = new THREE.Vector2(10, 10); // off-screen until first real move
    let hoveredLocal: number | null = null;

    function onPointerDown(e: PointerEvent) {
      isDragging = true;
      dragDistance = 0;
      prevX = e.clientX;
      prevY = e.clientY;
    }
    function onPointerMove(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouseNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      if (!isDragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      dragDistance += Math.abs(dx) + Math.abs(dy);
      group.rotation.y += dx * 0.006;
      group.rotation.x += dy * 0.004;
      rotationVelocity = { x: dy * 0.0002, y: dx * 0.0002 };
      prevX = e.clientX;
      prevY = e.clientY;
    }
    function onPointerUp() {
      isDragging = false;
      if (dragDistance < 6 && hoveredLocal !== null) {
        onSelectRef.current(points[hoveredLocal].region.index);
      }
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      camera.position.z = Math.min(14, Math.max(3.5, camera.position.z + e.deltaY * 0.01));
    }
    function onLeave() {
      mouseNdc.set(10, 10);
    }
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("pointerleave", onLeave);

    let raf: number;
    let stopped = false;
    const clock = new THREE.Clock();
    const projected = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();
    raycaster.params.Sprite = { threshold: 0.15 };

    function animate() {
      if (stopped) return;
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      if (!isDragging) {
        group.rotation.y += rotationVelocity.y;
        group.rotation.x += rotationVelocity.x;
        rotationVelocity.x *= 0.95;
        rotationVelocity.y += (0.0016 - rotationVelocity.y) * 0.02;
      }

      // Hover/selection visual state + nearest-point detection via
      // raycasting against the actual sprites (real hit-testing, not an
      // approximation) — cheap enough at this point count (<= a few
      // hundred) to run every frame.
      raycaster.setFromCamera(mouseNdc, camera);
      const hits = raycaster.intersectObjects(sprites, false);
      const newHovered = hits.length > 0 ? sprites.indexOf(hits[0].object as THREE.Sprite) : null;
      if (newHovered !== hoveredLocal) {
        hoveredLocal = newHovered;
        onHoverRef.current(hoveredLocal !== null ? points[hoveredLocal].region.index : null);
      }

      const selected = selectedIndexRef.current;
      sprites.forEach((sprite, i) => {
        const region = points[i].region;
        const isActive = selected === region.index || hoveredLocal === i;
        const pulse = isActive ? 1.5 + Math.sin(t * 4) * 0.15 : 1;
        const baseScale = 0.12 + Math.sqrt((region.endByte - region.startByte) / maxSize) * 0.22;
        sprite.scale.set(baseScale * pulse, baseScale * pulse, 1);
        (sprite.material as THREE.SpriteMaterial).opacity = selected !== null && !isActive ? 0.3 : 1;
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
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      ridgeGeo.dispose();
      ridgeMat.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      glowTexture.dispose();
      sprites.forEach((s) => (s.material as THREE.SpriteMaterial).dispose());
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
    };
  }, [webglReady, regions, fileSize]);

  return (
    <div className="rounded-lg border border-border overflow-hidden relative" style={{ height: 320 }}>
      <div className="absolute top-2 left-2 z-10 text-[10px] text-slate-500 hud-text pointer-events-none">
        3D entropy landscape · X=offset Y=entropy Z=density · drag to rotate · scroll to zoom · click a point to select
      </div>
      {webglReady === true && <div ref={mountRef} className="absolute inset-0" />}
      {webglReady === false && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500 px-4 text-center">
          3D rendering unavailable on this device/browser — the heatmap and topology views above show the same real data in 2D.
        </div>
      )}
      {webglReady === null && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-5 w-5 text-accent animate-spin" />
        </div>
      )}
    </div>
  );
}
