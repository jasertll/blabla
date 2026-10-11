// STAND-IN: the original lib/worldOutline.ts (real continent silhouettes) was
// not included in the migration package. This paints an equirectangular
// ocean with a graticule so SatelliteTracker renders; replace this file with
// the original to get the continents back.

export function paintWorldTexture(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#0b2a44");
  g.addColorStop(0.5, "#0e3a5c");
  g.addColorStop(1, "#0b2a44");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(103,232,249,0.18)";
  ctx.lineWidth = 1;
  for (let lon = 0; lon <= 360; lon += 15) {
    const x = (lon / 360) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let lat = -90; lat <= 90; lat += 15) {
    const y = ((90 - lat) / 180) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}
