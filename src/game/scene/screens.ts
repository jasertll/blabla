import * as THREE from "three";

// Animated CRT screen textures. One shared canvas per look, redrawn a few
// times a second by <ScreenTicker/>, so dozens of monitors cost one upload.

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

class Screen {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  constructor(
    w: number,
    h: number,
    private draw: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void,
  ) {
    this.canvas = makeCanvas(w, h);
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }
  update(t: number) {
    this.draw(this.ctx, this.canvas.width, this.canvas.height, t);
    this.texture.needsUpdate = true;
  }
}

function scanlines(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  const bar = ((t * 40) % (h + 60)) - 60;
  const g = ctx.createLinearGradient(0, bar, 0, bar + 60);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.5, "rgba(255,255,255,0.08)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, bar, w, 60);
}

function staticNoise(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.random() * 150;
    d[i] = v * 0.85;
    d[i + 1] = v * 0.9;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (Math.floor(t * 0.5) % 3 === 0) {
    ctx.fillStyle = "rgba(10,10,10,0.75)";
    ctx.fillRect(w * 0.12, h * 0.4, w * 0.76, h * 0.2);
    ctx.fillStyle = "#d6d2c4";
    ctx.font = `${Math.round(h * 0.09)}px VT323, monospace`;
    ctx.textAlign = "center";
    ctx.fillText("KEV FEED — NO SIGNAL", w / 2, h * 0.53);
  }
  scanlines(ctx, w, h, t);
}

const TERMINAL_LINES = [
  "BROOKHAVEN NETSEC TERMINAL v2.01",
  "------------------------------",
  "> IP / ASN ANALYZER",
  "> STATUS: AWAITING INPUT",
  "",
  "> WHO ARE YOU LOOKING FOR?",
];

function terminal(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.fillStyle = "#031007";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#3dff7a";
  ctx.shadowColor = "#3dff7a";
  ctx.shadowBlur = 6;
  ctx.font = `${Math.round(h * 0.075)}px VT323, monospace`;
  const shown = Math.min(TERMINAL_LINES.length, Math.floor((t % 14) * 1.5));
  TERMINAL_LINES.slice(0, shown).forEach((line, i) => ctx.fillText(line, w * 0.06, h * 0.13 + i * h * 0.1));
  if (Math.floor(t * 2) % 2 === 0) ctx.fillRect(w * 0.06, h * 0.13 + shown * h * 0.1 - h * 0.06, w * 0.035, h * 0.07);
  ctx.shadowBlur = 0;
  scanlines(ctx, w, h, t);
}

let screens: { static: Screen; terminal: Screen } | null = null;

export function getScreens() {
  if (!screens) {
    screens = {
      static: new Screen(160, 120, staticNoise),
      terminal: new Screen(320, 240, terminal),
    };
  }
  return screens;
}
