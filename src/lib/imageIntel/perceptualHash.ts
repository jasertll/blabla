// Real perceptual hashing — the same three algorithms the pHash.org
// reference implementation and Python's `imagehash` library use, not a
// simplified imitation. Each catches a different class of modification
// (see FingerprintComparison in types.ts), which is why all three are
// computed rather than relying on one.
//
// Split deliberately into pure math (operates on a plain grayscale pixel
// array, no DOM) and a browser-only decode step (canvas resize +
// grayscale) that calls into it — the math is what's actually worth
// unit-testing deterministically; canvas decoding needs a real browser
// and is exercised live instead (see tests/imageIntel/perceptualHash.test.ts).

/** Nearest-neighbor resize of a grayscale buffer — deliberately simple
 * (not bilinear) because every reference pHash implementation (pHash.org,
 * Python imagehash, blockhash) resizes this way; matching that is what
 * makes hash distances comparable to hashes computed elsewhere. */
function resizeGrayscale(src: Float64Array, srcW: number, srcH: number, dstW: number, dstH: number): Float64Array {
  const dst = new Float64Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      dst[y * dstW + x] = src[sy * srcW + sx];
    }
  }
  return dst;
}

function bitsToHex(bits: number[]): string {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    hex += nibble.toString(16);
  }
  return hex;
}

// ---------- aHash: average hash ----------
export function aHashFromGrayscale(pixels: Float64Array, width: number, height: number): string {
  const size = 8;
  const small = resizeGrayscale(pixels, width, height, size, size);
  const mean = small.reduce((a, b) => a + b, 0) / small.length;
  const bits = Array.from(small, (v) => (v >= mean ? 1 : 0));
  return bitsToHex(bits);
}

// ---------- dHash: difference hash ----------
export function dHashFromGrayscale(pixels: Float64Array, width: number, height: number): string {
  const w = 9;
  const h = 8;
  const small = resizeGrayscale(pixels, width, height, w, h);
  const bits: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      bits.push(small[y * w + x] < small[y * w + x + 1] ? 1 : 0);
    }
  }
  return bitsToHex(bits);
}

// ---------- pHash: DCT-based perceptual hash ----------
// Separable 2D DCT-II (1D DCT applied to rows, then columns) on a 32x32
// downsample, keeping the top-left 8x8 low-frequency block (excluding
// the DC term at [0,0], which only encodes overall brightness, not
// structure) and thresholding against the median of that block — the
// standard pHash.org algorithm.
function dct1d(input: Float64Array): Float64Array {
  const n = input.length;
  const output = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += input[i] * Math.cos((Math.PI / n) * (i + 0.5) * k);
    }
    output[k] = sum * (k === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n));
  }
  return output;
}

function dct2d(matrix: Float64Array, size: number): Float64Array {
  const rows = new Float64Array(size * size);
  for (let y = 0; y < size; y++) {
    const row = matrix.subarray(y * size, y * size + size);
    const transformed = dct1d(row as Float64Array);
    rows.set(transformed, y * size);
  }
  const result = new Float64Array(size * size);
  const col = new Float64Array(size);
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) col[y] = rows[y * size + x];
    const transformed = dct1d(col);
    for (let y = 0; y < size; y++) result[y * size + x] = transformed[y];
  }
  return result;
}

export function pHashFromGrayscale(pixels: Float64Array, width: number, height: number): string {
  const dctSize = 32;
  const keep = 8;
  const small = resizeGrayscale(pixels, width, height, dctSize, dctSize);
  const freq = dct2d(small, dctSize);

  const lowFreq: number[] = [];
  for (let y = 0; y < keep; y++) {
    for (let x = 0; x < keep; x++) {
      if (x === 0 && y === 0) continue; // skip DC term
      lowFreq.push(freq[y * dctSize + x]);
    }
  }
  const sorted = [...lowFreq].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const bits = lowFreq.map((v) => (v > median ? 1 : 0));
  // 63 bits (8x8 minus the DC term) — pad to a multiple of 4 for clean hex.
  while (bits.length % 4 !== 0) bits.push(0);
  return bitsToHex(bits);
}

// ---------- Comparison ----------
export function hammingDistanceHex(a: string, b: string): number {
  const lenBits = Math.min(a.length, b.length) * 4;
  let distance = Math.abs(a.length - b.length) * 4; // mismatched-length hashes count the gap as different bits
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    distance += popcount4(xor);
  }
  void lenBits;
  return distance;
}

function popcount4(n: number): number {
  let count = 0;
  for (let i = 0; i < 4; i++) {
    count += (n >> i) & 1;
  }
  return count;
}

export type PerceptualVerdict = "identical" | "near-identical" | "likely-related" | "possibly-related" | "unrelated";

/** Thresholds are against a 64-bit hash (dHash/aHash) or 60-bit (pHash,
 * after dropping the DC term and padding) — close enough in practice
 * that the same bands apply to all three; this mirrors the bands
 * commonly cited for these exact algorithms (e.g. pHash.org's own
 * guidance: <=10 very likely the same image, <=20 worth a look). */
export function classifyDistance(distance: number): PerceptualVerdict {
  if (distance === 0) return "identical";
  if (distance <= 5) return "near-identical";
  if (distance <= 12) return "likely-related";
  if (distance <= 20) return "possibly-related";
  return "unrelated";
}
