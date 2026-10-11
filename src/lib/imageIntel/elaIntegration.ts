// Thin wrapper around this codebase's own, already-tested ELA engine
// (lib/imageForensics.ts's analyzeEla, used by components/forensics/
// ImageForensics.tsx) — reused here rather than reimplemented, same
// resave-and-compare technique: draw original to canvas, re-encode as
// JPEG at a fixed quality, decode that back, diff the two pixel buffers.
import { analyzeEla, type ElaVerdict } from "../imageForensics";
import type { DecodedImage } from "./imageDecode";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load resaved image for ELA."));
    img.src = src;
  });
}

export async function runElaAnalysis(decoded: DecodedImage, wasOriginallyJpeg: boolean): Promise<ElaVerdict> {
  const { canvas, width, height } = decoded;
  const ctx = canvas.getContext("2d")!;
  const originalData = ctx.getImageData(0, 0, width, height);

  const resavedDataUrl = canvas.toDataURL("image/jpeg", 0.9);
  const resavedImg = await loadImage(resavedDataUrl);
  const resavedCanvas = document.createElement("canvas");
  resavedCanvas.width = width;
  resavedCanvas.height = height;
  const rctx = resavedCanvas.getContext("2d")!;
  rctx.drawImage(resavedImg, 0, 0);
  const resavedData = rctx.getImageData(0, 0, width, height);

  return analyzeEla(originalData, resavedData, wasOriginallyJpeg);
}
