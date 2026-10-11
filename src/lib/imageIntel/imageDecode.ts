// Browser-only image decoding — the one place a File becomes a real
// decoded bitmap (canvas), which every downstream browser-only module
// (perceptual hashing, face/object detection, local-feature matching)
// needs. Separated from the pure math modules precisely so those stay
// unit-testable without a real browser (see each module's own comment).
import { checkDecodedDimensions } from "./ingestion";
import { aHashFromGrayscale, dHashFromGrayscale, pHashFromGrayscale } from "./perceptualHash";
import type { PerceptualHashes } from "./types";

export type DecodedImage = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
};

export type DecodeResult = { ok: true; image: DecodedImage } | { ok: false; reason: string };

export async function decodeImageFile(file: File): Promise<DecodeResult> {
  try {
    const bitmap = await createImageBitmap(file);
    const dimCheck = checkDecodedDimensions(bitmap.width, bitmap.height);
    if (!dimCheck.ok) {
      bitmap.close();
      return { ok: false, reason: dimCheck.reason };
    }

    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return { ok: false, reason: "Could not acquire a 2D canvas context." };
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    return { ok: true, image: { canvas, width: canvas.width, height: canvas.height } };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? `Could not decode this image: ${err.message}` : "Could not decode this image." };
  }
}

function toGrayscale(canvas: HTMLCanvasElement): { pixels: Float64Array; width: number; height: number } {
  const ctx = canvas.getContext("2d")!;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    pixels[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return { pixels, width, height };
}

export function computePerceptualHashes(decoded: DecodedImage): PerceptualHashes {
  const { pixels, width, height } = toGrayscale(decoded.canvas);
  return {
    aHash: aHashFromGrayscale(pixels, width, height),
    dHash: dHashFromGrayscale(pixels, width, height),
    pHash: pHashFromGrayscale(pixels, width, height),
  };
}
