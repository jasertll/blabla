import * as THREE from "three";

// A "shooting star" comet is two separate sprites, not one rotating
// texture — that's the fix for a comet that used to read as a single
// rigid spinning triangle instead of a star with a trailing tail:
//
//  - the HEAD is a plain symmetric radial-gradient dot. Its texture is
//    rotationally symmetric, so even though callers still spin
//    Sprite.material.rotation on it for consistency, nothing about its
//    appearance changes — it always reads as a clean, stable, round star.
//  - the TAIL is a separate, asymmetric streak texture (bright near one
//    edge, fading to nothing at the other). Callers position the tail
//    sprite at the SAME point as the head and set `tailSprite.center`
//    to the texture-space coordinate of that bright edge (see
//    TAIL_ANCHOR_U/V below) — Sprite.center is the pivot Three.js
//    rotates *and* positions the sprite around, so the bright anchor
//    stays pinned exactly on the head while the faint end sweeps out
//    behind it as `material.rotation` tracks the comet's direction of
//    travel. Animate that rotation (and the tail's scale, for a pulsing
//    length) every frame or it goes back to reading as static.
export const TAIL_ANCHOR_U = 0.86;
export const TAIL_ANCHOR_V = 0.5;

export function makeCometHeadTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.85)");
  g.addColorStop(0.7, "rgba(255,255,255,0.3)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// A real comet tail is not one hard-edged wedge — it's several soft,
// wavy, glowing strands trailing off the coma (see any reference photo:
// "Coma" bright head, "Tail" a loose bundle of curved wisps). Each call
// bakes ONE such wavy, feathered strand, tapering from a soft bright
// base at the anchor to nothing at the tip; callers layer 3–4 of these
// (each with a different waveSeed, and independently animated
// rotation/opacity per frame) behind a single round head sprite so the
// whole thing reads as a flowing, moving tail rather than a static
// flashlight cone.
export function makeCometWispTexture(waveSeed: number): THREE.Texture {
  const w = 240;
  const h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const anchorX = w * TAIL_ANCHOR_U;
  const anchorY = h * TAIL_ANCHOR_V;

  const segments = 28;
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments; // 0 at the anchor, 1 at the far tip
    const x = anchorX * (1 - t);
    // Waviness grows with distance from the head, like a real tail
    // loosening as it trails off — not a rigid straight taper.
    const wave = Math.sin(t * Math.PI * 2.6 + waveSeed) * h * 0.16 * t;
    const y = anchorY + wave;
    const halfWidth = (1 - t) * h * 0.16 + 0.6;
    top.push([x, y - halfWidth]);
    bottom.push([x, y + halfWidth]);
  }

  ctx.save();
  ctx.beginPath();
  top.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  for (let i = bottom.length - 1; i >= 0; i--) ctx.lineTo(bottom[i][0], bottom[i][1]);
  ctx.closePath();
  // Soften the edges so it glows instead of reading as a flat cut shape.
  ctx.filter = "blur(2.5px)";
  const grad = ctx.createLinearGradient(anchorX, 0, 0, 0);
  grad.addColorStop(0, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.4)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  // Small sharp bright cap right at the anchor so it visually fuses with
  // the head sprite instead of leaving a seam.
  const cap = ctx.createRadialGradient(anchorX, anchorY, 0, anchorX, anchorY, h * 0.22);
  cap.addColorStop(0, "rgba(255,255,255,0.9)");
  cap.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = cap;
  ctx.beginPath();
  ctx.arc(anchorX, anchorY, h * 0.22, 0, Math.PI * 2);
  ctx.fill();

  return new THREE.CanvasTexture(canvas);
}
