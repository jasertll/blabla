import * as THREE from "three";

// All surfaces are painted procedurally on canvases: no downloads, and every
// texture has an Otherworld counterpart generated the same way.

let seed = 1337;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

const PERM = (() => {
  const p = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
})();

const fade = (t: number) => t * t * (3 - 2 * t);
const hash = (x: number, y: number) => PERM[(PERM[x & 255] + y) & 511] / 255;

function noise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  const u = fade(xf);
  const v = fade(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal noise, tileable over `period` cells at the base octave. */
function fbm(x: number, y: number, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * f, y * f);
    f *= 2;
    amp *= 0.5;
  }
  return sum;
}

function canvas(w: number, h = w) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

/** Multiplies grime noise over whatever is already drawn. */
function grime(ctx: CanvasRenderingContext2D, w: number, h: number, scale: number, strength: number, tint = [40, 34, 26]) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm((x / w) * scale, (y / h) * scale, 5);
      const k = Math.max(0, n - 0.42) * strength;
      const i = (y * w + x) * 4;
      d[i] = d[i] * (1 - k) + tint[0] * k;
      d[i + 1] = d[i + 1] * (1 - k) + tint[1] * k;
      d[i + 2] = d[i + 2] * (1 - k) + tint[2] * k;
      // fine grain everywhere
      const g = (rand() - 0.5) * 14;
      d[i] += g;
      d[i + 1] += g;
      d[i + 2] += g;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function drips(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, color: string, maxLen = 0.6) {
  ctx.strokeStyle = color;
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const len = rand() * h * maxLen;
    const y0 = rand() < 0.7 ? 0 : rand() * h * 0.4;
    ctx.globalAlpha = 0.08 + rand() * 0.18;
    ctx.lineWidth = 1 + rand() * 4;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    let cx = x;
    for (let y = y0; y < y0 + len; y += 6) {
      cx += (rand() - 0.5) * 1.5;
      ctx.lineTo(cx, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function stains(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, color: string, rMax: number) {
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = rMax * (0.3 + rand());
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.3 + rand() * 0.5;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.5 + rand()), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function cracks(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, color: string) {
  ctx.strokeStyle = color;
  for (let i = 0; i < count; i++) {
    let x = rand() * w;
    let y = rand() * h;
    let a = rand() * Math.PI * 2;
    ctx.globalAlpha = 0.4 + rand() * 0.4;
    ctx.lineWidth = 0.6 + rand() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 8 + rand() * 30;
    for (let s = 0; s < steps; s++) {
      a += (rand() - 0.5) * 1.1;
      x += Math.cos(a) * 7;
      y += Math.sin(a) * 7;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function toTexture(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- surfaces

function paintWall() {
  const S = 1024;
  const [c, ctx] = canvas(S);
  // upper paint
  ctx.fillStyle = "#a3a693";
  ctx.fillRect(0, 0, S, S);
  // wainscot (bottom ~27% of a 4m wall ≈ 1.1m)
  const band = S * 0.73;
  ctx.fillStyle = "#4f5c55";
  ctx.fillRect(0, band, S, S - band);
  ctx.fillStyle = "#2d3430";
  ctx.fillRect(0, band - 10, S, 10);
  ctx.fillStyle = "#6b766d";
  ctx.fillRect(0, band - 14, S, 4);
  // peeling patches revealing plaster
  for (let i = 0; i < 9; i++) {
    const x = rand() * S;
    const y = rand() * band * 0.95;
    const r = 18 + rand() * 46;
    ctx.fillStyle = rand() > 0.5 ? "#857e6b" : "#928b77";
    ctx.beginPath();
    const n = 22;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      const rr = r * (0.65 + noise(i * 7 + Math.cos(a) * 2, i * 3 + Math.sin(a) * 2) * 0.7);
      const px = x + Math.cos(a) * rr * 1.3;
      const py = y + Math.sin(a) * rr;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    // curled paint edge: a light lip with a dark shadow under it
    ctx.strokeStyle = "rgba(200,198,180,.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.translate(1.5, 2.5);
    ctx.strokeStyle = "rgba(25,22,16,.35)";
    ctx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  drips(ctx, S, S, 160, "#3b3427", 0.8);
  stains(ctx, S, S, 10, "rgba(70,55,30,0.6)", 90);
  stains(ctx, S, S * 0.2, 6, "rgba(20,18,14,0.7)", 120); // ceiling-line soot
  cracks(ctx, S, S, 12, "#2a251d");
  grime(ctx, S, S, 6, 1.1);
  return c;
}

function paintRust() {
  const S = 1024;
  const [c, ctx] = canvas(S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm((x / S) * 8, (y / S) * 8, 6);
      const m = fbm((x / S) * 3 + 10, (y / S) * 3, 3);
      const i = (y * S + x) * 4;
      const r = 60 + n * 90 + m * 40;
      d[i] = r;
      d[i + 1] = r * 0.48;
      d[i + 2] = r * 0.3;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // riveted panel seams
  ctx.strokeStyle = "rgba(10,5,3,.85)";
  ctx.lineWidth = 6;
  for (let k = 0; k <= 4; k++) {
    ctx.beginPath();
    ctx.moveTo((k * S) / 4, 0);
    ctx.lineTo((k * S) / 4, S);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(20,10,6,.9)";
  for (let k = 0; k <= 4; k++) for (let y = 20; y < S; y += 64) {
    ctx.beginPath();
    ctx.arc((k * S) / 4 + 12, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  drips(ctx, S, S, 120, "#1b0805", 0.9);
  drips(ctx, S, S, 40, "#4a0b07", 0.5);
  stains(ctx, S, S, 8, "rgba(80,6,4,0.8)", 120); // blood
  stains(ctx, S, S, 16, "rgba(5,2,1,0.9)", 90);
  return c;
}

function paintTiles() {
  const S = 1024;
  const [c, ctx] = canvas(S);
  const n = 8;
  const t = S / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const light = (x + y) % 2 === 0;
      const v = (rand() - 0.5) * 16;
      ctx.fillStyle = light ? `rgb(${182 + v},${178 + v},${164 + v})` : `rgb(${92 + v},${96 + v},${90 + v})`;
      ctx.fillRect(x * t, y * t, t, t);
    }
  ctx.strokeStyle = "#2d2b25";
  ctx.lineWidth = 4;
  for (let k = 0; k <= n; k++) {
    ctx.beginPath();
    ctx.moveTo(k * t, 0);
    ctx.lineTo(k * t, S);
    ctx.moveTo(0, k * t);
    ctx.lineTo(S, k * t);
    ctx.stroke();
  }
  stains(ctx, S, S, 14, "rgba(50,40,25,0.7)", 110);
  stains(ctx, S, S, 3, "rgba(70,12,8,0.55)", 60);
  cracks(ctx, S, S, 18, "#1f1c17");
  grime(ctx, S, S, 5, 1.3);
  return c;
}

function paintGrate() {
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = "#050302";
  ctx.fillRect(0, 0, S, S);
  const step = 32;
  for (let k = 0; k <= S; k += step) {
    ctx.fillStyle = "#3d2316";
    ctx.fillRect(k - 3, 0, 6, S);
    ctx.fillRect(0, k - 3, S, 6);
    ctx.fillStyle = "#6a3a1e";
    ctx.fillRect(k - 3, 0, 2, S);
    ctx.fillRect(0, k - 3, S, 2);
  }
  stains(ctx, S, S, 10, "rgba(60,8,4,0.8)", 60);
  grime(ctx, S, S, 6, 1.2, [10, 4, 2]);
  return c;
}

function paintCeiling() {
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = "#9b9a8e";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(40,38,30,${rand() * 0.3})`;
    ctx.fillRect(rand() * S, rand() * S, 1.5, 1.5);
  }
  ctx.strokeStyle = "#55534a";
  ctx.lineWidth = 8;
  ctx.strokeRect(0, 0, S, S);
  ctx.beginPath();
  ctx.moveTo(S / 2, 0);
  ctx.lineTo(S / 2, S);
  ctx.moveTo(0, S / 2);
  ctx.lineTo(S, S / 2);
  ctx.stroke();
  // water rings
  for (let i = 0; i < 4; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 30 + rand() * 70;
    const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r);
    g.addColorStop(0, "rgba(120,90,40,0.15)");
    g.addColorStop(0.9, "rgba(90,60,25,0.55)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  grime(ctx, S, S, 4, 1);
  return c;
}

function paintDoor(otherworld: boolean) {
  const W = 256;
  const H = 512;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = otherworld ? "#3a1a0e" : "#5d6a63";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = otherworld ? "#140603" : "#38423d";
  ctx.lineWidth = 6;
  ctx.strokeRect(22, 30, W - 44, H * 0.34);
  ctx.strokeRect(22, H * 0.46, W - 44, H * 0.46);
  // small wired window
  ctx.fillStyle = otherworld ? "#0a0302" : "#1d2422";
  ctx.fillRect(70, 60, W - 140, 110);
  ctx.strokeStyle = otherworld ? "#4a2010" : "#7c8580";
  ctx.lineWidth = 1;
  for (let k = 0; k < 120; k += 12) {
    ctx.beginPath();
    ctx.moveTo(70 + k, 60);
    ctx.lineTo(70, 60 + k);
    ctx.stroke();
  }
  drips(ctx, W, H, 40, otherworld ? "#120402" : "#2a2a22", 0.7);
  grime(ctx, W, H, 4, 1.2);
  return c;
}

function paintAsphalt() {
  const S = 1024;
  const [c, ctx] = canvas(S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const n = fbm((x / S) * 10, (y / S) * 10, 5);
      const v = 38 + n * 40 + (rand() - 0.5) * 22;
      const i = (y * S + x) * 4;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v * 1.02;
      d[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = "rgba(170,165,140,.55)";
  for (let y = 0; y < S; y += 256) ctx.fillRect(S / 2 - 8, y, 16, 150);
  cracks(ctx, S, S, 40, "#141414");
  stains(ctx, S, S, 10, "rgba(10,10,10,0.6)", 120);
  return c;
}

function paintFacade() {
  const W = 1024;
  const H = 512;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = "#7c7a72";
  ctx.fillRect(0, 0, W, H);
  // horizontal concrete bands
  for (let y = 0; y < H; y += 64) {
    ctx.fillStyle = "rgba(40,38,32,.35)";
    ctx.fillRect(0, y, W, 3);
  }
  // window grid
  const cols = 12;
  const rows = 4;
  for (let r = 0; r < rows; r++)
    for (let k = 0; k < cols; k++) {
      const x = 20 + (k * (W - 40)) / cols;
      const y = 30 + (r * (H - 60)) / rows;
      const lit = rand() < 0.08;
      ctx.fillStyle = lit ? "#6d6248" : "#16191a";
      ctx.fillRect(x + 10, y + 10, (W - 40) / cols - 20, (H - 60) / rows - 34);
      ctx.strokeStyle = "#3a3a35";
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 10, y + 10, (W - 40) / cols - 20, (H - 60) / rows - 34);
    }
  drips(ctx, W, H, 200, "#2c2a24", 0.9);
  grime(ctx, W, H, 6, 1.1);
  return c;
}

function paintSign() {
  const [c, ctx] = canvas(1024, 160);
  ctx.fillStyle = "#1c1d1b";
  ctx.fillRect(0, 0, 1024, 160);
  ctx.fillStyle = "#c9c4b0";
  ctx.font = "600 84px 'Cormorant Garamond', Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("BROOKHAVEN  HOSPITAL", 512, 84);
  grime(ctx, 1024, 160, 8, 1.4);
  return c;
}

function paintBlood() {
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = "rgba(70,6,4,0.9)";
  // a dragged smear
  for (let i = 0; i < 60; i++) {
    const t = i / 60;
    const x = S * 0.15 + t * S * 0.7 + (rand() - 0.5) * 20;
    const y = S * 0.5 + Math.sin(t * 5) * 30 + (rand() - 0.5) * 20;
    ctx.globalAlpha = 0.15 + (1 - t) * 0.3;
    ctx.beginPath();
    ctx.ellipse(x, y, 30 * (1 - t * 0.6), 18, rand(), 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 30; i++) {
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(rand() * S, S * 0.5 + (rand() - 0.5) * 160, rand() * 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return c;
}

function paintSilhouette() {
  const W = 256;
  const H = 512;
  const [c, ctx] = canvas(W, H);
  const g = ctx.createRadialGradient(W / 2, H * 0.55, 10, W / 2, H * 0.55, W);
  g.addColorStop(0, "rgba(0,0,0,0.95)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = "rgba(0,0,0,0.92)";
  ctx.filter = "blur(6px)";
  // head
  ctx.beginPath();
  ctx.ellipse(W / 2, H * 0.12, 26, 34, 0, 0, Math.PI * 2);
  ctx.fill();
  // body
  ctx.beginPath();
  ctx.moveTo(W / 2 - 50, H * 0.2);
  ctx.quadraticCurveTo(W / 2 - 70, H * 0.5, W / 2 - 34, H * 0.98);
  ctx.lineTo(W / 2 + 34, H * 0.98);
  ctx.quadraticCurveTo(W / 2 + 70, H * 0.5, W / 2 + 50, H * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.filter = "none";
  return c;
}

function paintWriting(text: string) {
  const [c, ctx] = canvas(1024, 256);
  ctx.clearRect(0, 0, 1024, 256);
  ctx.fillStyle = "rgba(90,8,6,0.85)";
  ctx.font = "bold 92px 'Special Elite', 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.save();
  ctx.translate(512, 128);
  ctx.rotate(-0.04);
  ctx.fillText(text, 0, 0);
  ctx.restore();
  // runs of paint dripping from letters
  ctx.strokeStyle = "rgba(80,6,4,0.7)";
  for (let i = 0; i < 26; i++) {
    const x = 120 + rand() * 780;
    ctx.lineWidth = 2 + rand() * 3;
    ctx.beginPath();
    ctx.moveTo(x, 150);
    ctx.lineTo(x + (rand() - 0.5) * 4, 150 + rand() * 90);
    ctx.stroke();
  }
  return c;
}

// ---------------------------------------------------------------- cache

type Key = "wall" | "rust" | "tiles" | "grate" | "ceiling" | "door" | "doorOW" | "asphalt" | "facade" | "sign" | "blood" | "silhouette";

const cache = new Map<string, THREE.CanvasTexture>();

const painters: Record<Key, () => HTMLCanvasElement> = {
  wall: paintWall,
  rust: paintRust,
  tiles: paintTiles,
  grate: paintGrate,
  ceiling: paintCeiling,
  door: () => paintDoor(false),
  doorOW: () => paintDoor(true),
  asphalt: paintAsphalt,
  facade: paintFacade,
  sign: paintSign,
  blood: paintBlood,
  silhouette: paintSilhouette,
};

/** Base texture (shared image). Use `tex()` with repeat to get a per-surface clone. */
export function baseTexture(key: Key): THREE.CanvasTexture {
  let t = cache.get(key);
  if (!t) {
    t = toTexture(painters[key]());
    cache.set(key, t);
  }
  return t;
}

export function tex(key: Key, repeatX = 1, repeatY = 1): THREE.Texture {
  const t = baseTexture(key).clone();
  t.repeat.set(repeatX, repeatY);
  t.needsUpdate = true;
  return t;
}

export function writingTexture(text: string) {
  const k = `w:${text}`;
  let t = cache.get(k);
  if (!t) {
    t = toTexture(paintWriting(text));
    cache.set(k, t);
  }
  return t;
}
