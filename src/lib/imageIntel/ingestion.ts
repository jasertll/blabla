// Image acquisition & safe-processing gate — the pipeline's entry point.
// Never trusts the uploaded filename or Content-Type header (spec
// section 1); identity is established from the file's own magic bytes,
// reusing this platform's existing 70+-signature scanner
// (lib/fileAnalysis/signatures.ts, already covers JPEG/PNG/GIF/WebP/
// BMP/TIFF — see the signature table there) rather than a second,
// parallel magic-byte table.
import { detectFileType, type FileSignature } from "../fileAnalysis/signatures";

export const SUPPORTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
]);

export const MAX_FILE_BYTES = 40 * 1024 * 1024; // 40MB
export const MAX_DIMENSION_PX = 12_000; // guards decompression-bomb-style huge canvases
export const MAX_DECODED_PIXELS = 80_000_000; // ~80 megapixels decoded — the real memory-exhaustion guard, since a small file can still decode to an enormous bitmap

export type IngestionResult =
  | { ok: true; bytes: Uint8Array; detectedFormat: FileSignature; extensionMismatch: boolean; declaredExtension: string }
  | { ok: false; reason: string };

function extensionOf(fileName: string): string {
  const match = fileName.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}

/** Validates the raw bytes BEFORE any decode is attempted — magic-byte
 * identity, supported format, size ceiling. Dimension/decoded-pixel
 * limits are enforced separately once the image is actually decoded
 * (see checkDecodedDimensions below), since file size alone doesn't
 * predict decoded memory footprint (a tiny, highly-compressed PNG can
 * still decode to a huge bitmap — the classic decompression-bomb
 * pattern this guards against). */
export function validateImageBytes(bytes: Uint8Array, fileName: string): IngestionResult {
  if (bytes.length === 0) return { ok: false, reason: "Empty file." };
  if (bytes.length > MAX_FILE_BYTES) {
    return { ok: false, reason: `File is ${(bytes.length / 1024 / 1024).toFixed(1)}MB, which exceeds the ${MAX_FILE_BYTES / 1024 / 1024}MB limit.` };
  }

  const detected = detectFileType(bytes);
  if (!detected || !SUPPORTED_MIME_TYPES.has(detected.mime)) {
    return {
      ok: false,
      reason: detected
        ? `This file's actual content is ${detected.label}, not a supported image format.`
        : "This file's content doesn't match any known image format's magic bytes — it may be corrupted, encrypted, or not an image at all.",
    };
  }

  const declaredExtension = extensionOf(fileName);
  const extensionMismatch = declaredExtension !== "" && !detected.typicalExtensions.includes(declaredExtension);

  return { ok: true, bytes, detectedFormat: detected, extensionMismatch, declaredExtension };
}

export type DimensionCheck = { ok: true } | { ok: false; reason: string };

/** Called once width/height are known (after a real decode) — the
 * actual decompression-bomb guard, since the risk is decoded pixel
 * memory, not file size. */
export function checkDecodedDimensions(width: number, height: number): DimensionCheck {
  if (width <= 0 || height <= 0) return { ok: false, reason: "Image decoded to zero/invalid dimensions — likely corrupted." };
  if (width > MAX_DIMENSION_PX || height > MAX_DIMENSION_PX) {
    return { ok: false, reason: `Image dimensions ${width}x${height} exceed the ${MAX_DIMENSION_PX}px per-side limit.` };
  }
  const pixels = width * height;
  if (pixels > MAX_DECODED_PIXELS) {
    return { ok: false, reason: `Image decodes to ${pixels.toLocaleString()} pixels, exceeding the ${MAX_DECODED_PIXELS.toLocaleString()}-pixel limit — a possible decompression-bomb pattern (small file, enormous decoded size).` };
  }
  return { ok: true };
}
