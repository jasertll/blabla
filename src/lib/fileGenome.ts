// Real, additional per-region analysis layered on top of
// lib/fileAnalysis/entropy.ts's existing block entropy — this is the
// data model the Digital DNA tool's coordinated visualizations read
// from. Every field here is computed directly from the file's actual
// bytes; nothing is asserted, randomized, or simulated for effect.

import { shannonEntropy } from "./fileAnalysis/entropy";

export type RegionClass = "null-padding" | "repetitive" | "ascii-text" | "structured" | "high-entropy";

export const REGION_CLASS_LABEL: Record<RegionClass, string> = {
  "null-padding": "Null/padding",
  repetitive: "Repetitive",
  "ascii-text": "ASCII text",
  structured: "Structured binary",
  "high-entropy": "High entropy",
};

// Same green→red convention used throughout the file-analysis tools,
// plus two extra hues for the two classes that aren't just "a point on
// the entropy scale" (padding reads as inert, not "safe"; ASCII text
// gets its own readable blue rather than collapsing into "structured").
export const REGION_CLASS_COLOR: Record<RegionClass, string> = {
  "null-padding": "#475569",
  repetitive: "#eab308",
  "ascii-text": "#38bdf8",
  structured: "#10b981",
  "high-entropy": "#dc2626",
};

export type GenomeRegion = {
  index: number;
  startByte: number;
  endByte: number;
  entropy: number;
  classification: RegionClass;
  uniqueByteCount: number;
  mostCommonByte: number;
  mostCommonByteFraction: number;
  printableFraction: number;
  /** How many OTHER regions have entropy within a small window of this
   * one — real neighbor density in entropy-space, used as the 3D
   * landscape's Z axis and as the basis for relationship-graph edges. */
  density: number;
};

function classifySlice(bytes: Uint8Array, entropy: number) {
  if (bytes.length === 0) {
    return { classification: "structured" as RegionClass, uniqueByteCount: 0, mostCommonByte: 0, mostCommonByteFraction: 0, printableFraction: 0 };
  }
  const freq = new Map<number, number>();
  let printable = 0;
  for (const b of bytes) {
    freq.set(b, (freq.get(b) ?? 0) + 1);
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)) printable++;
  }
  let mostCommonByte = 0;
  let mostCommonCount = 0;
  for (const [b, c] of freq) {
    if (c > mostCommonCount) {
      mostCommonByte = b;
      mostCommonCount = c;
    }
  }
  const mostCommonByteFraction = mostCommonCount / bytes.length;
  const printableFraction = printable / bytes.length;
  const uniqueByteCount = freq.size;

  let classification: RegionClass;
  if (mostCommonByte === 0 && mostCommonByteFraction > 0.85) classification = "null-padding";
  else if (entropy >= 7.2) classification = "high-entropy";
  else if (printableFraction > 0.9) classification = "ascii-text";
  else if (uniqueByteCount <= Math.max(4, bytes.length * 0.05)) classification = "repetitive";
  else classification = "structured";

  return { classification, uniqueByteCount, mostCommonByte, mostCommonByteFraction, printableFraction };
}

/** Builds the full per-region genome from the SAME blocks
 * computeEntropyProfile already produced — this never re-derives
 * entropy differently from what File / Malware Inspector shows, it only
 * adds classification + density on top of the identical numbers. */
export function buildGenomeRegions(bytes: Uint8Array, blockSize: number, blocks: number[]): GenomeRegion[] {
  const regions: GenomeRegion[] = blocks.map((entropy, i) => {
    const startByte = i * blockSize;
    const endByte = Math.min(startByte + blockSize, bytes.length);
    const cls = classifySlice(bytes.subarray(startByte, endByte), entropy);
    return { index: i, startByte, endByte, entropy, density: 0, ...cls };
  });

  // Neighbor density in entropy-space: how many other regions sit
  // within `epsilon` bits/byte of this one. O(n^2) but n is capped at
  // 2048 by computeEntropyProfile, so this stays well under 50ms even
  // at the largest file sizes this tool samples.
  const epsilon = 0.4;
  for (let i = 0; i < regions.length; i++) {
    let count = 0;
    for (let j = 0; j < regions.length; j++) {
      if (i === j) continue;
      if (Math.abs(regions[j].entropy - regions[i].entropy) <= epsilon) count++;
    }
    regions[i].density = count;
  }

  return regions;
}

export type RelationshipEdge = { a: number; b: number; strength: number };

/** Connects each region to its few most entropy-similar neighbors (not
 * every region to every other — that would just be a solid mesh) —
 * genuinely derived from the same real entropy numbers, not a
 * decorative "neural network." Mirrors the same "nearest-K within a
 * distance cap" idea ThreatGlobe's constellation lines use, applied to
 * this file's own regions instead of the threat-intel clusters. */
export function buildRelationshipEdges(regions: GenomeRegion[], maxLinksPerNode = 3, epsilon = 0.5): RelationshipEdge[] {
  const edges: RelationshipEdge[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < regions.length; i++) {
    const distances = regions
      .map((r, j) => ({ j, d: i === j ? Infinity : Math.abs(r.entropy - regions[i].entropy) }))
      .filter((x) => x.d <= epsilon)
      .sort((a, b) => a.d - b.d)
      .slice(0, maxLinksPerNode);
    for (const { j, d } of distances) {
      // Reference the regions' own stable .index (their real, global
      // position in the file), not the loop position — callers may pass
      // a sampled subset, and edges must still line up with whatever
      // index every other visualization uses to identify a region.
      const a = regions[i].index;
      const b = regions[j].index;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b, strength: 1 - d / epsilon });
    }
  }
  return edges;
}

/** Byte-value histogram across the whole file (sampled at a fixed
 * stride for very large files rather than truncated, so the shape stays
 * representative of the whole file, not just its first few MB). */
export function byteFrequencyHistogram(bytes: Uint8Array, sampleCap = 2_000_000): Uint32Array {
  const hist = new Uint32Array(256);
  const step = bytes.length > sampleCap ? Math.ceil(bytes.length / sampleCap) : 1;
  for (let i = 0; i < bytes.length; i += step) hist[bytes[i]]++;
  return hist;
}

export type RepeatedSequence = { bytes: number[]; count: number; firstOffset: number };

/** Real repeated-4-byte-sequence detection via a sampled sliding window
 * — this is what actually powers "repeated sequences" in the genome
 * fingerprint. Sampled (fixed stride) rather than exhaustive on large
 * files purely for browser performance; the counts are real occurrence
 * counts within the sampled positions, not fabricated. */
export function detectRepeatedSequences(bytes: Uint8Array, seqLen = 4, topN = 6, sampleCap = 500_000): RepeatedSequence[] {
  if (bytes.length < seqLen) return [];
  const step = bytes.length > sampleCap ? Math.ceil(bytes.length / sampleCap) : 1;
  const counts = new Map<number, { count: number; firstOffset: number }>();
  for (let i = 0; i + seqLen <= bytes.length; i += step) {
    let key = 0;
    for (let j = 0; j < seqLen; j++) key = key * 256 + bytes[i + j];
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { count: 1, firstOffset: i });
  }
  return Array.from(counts.entries())
    .filter(([, v]) => v.count > 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, topN)
    .map(([key, v]) => {
      const seqBytes: number[] = [];
      let k = key;
      for (let j = 0; j < seqLen; j++) {
        seqBytes.unshift(k % 256);
        k = Math.floor(k / 256);
      }
      return { bytes: seqBytes, count: v.count, firstOffset: v.firstOffset };
    });
}

/** Re-runs the same shannonEntropy() computation per block, one small
 * batch per animation frame, so "Replay Analysis" shows entropy values
 * actually being computed live — not a pre-computed result replayed
 * behind a fake progress bar. Returns a cancel function. */
export function replayEntropyComputation(
  bytes: Uint8Array,
  blockSize: number,
  totalBlocks: number,
  onBatch: (newlyComputed: number[]) => void,
  onDone: () => void,
  targetDurationMs = 2600
): () => void {
  let cancelled = false;
  let raf = 0;
  let i = 0;
  const batchPerFrame = Math.max(1, Math.ceil(totalBlocks / (targetDurationMs / 16.7)));

  function step() {
    if (cancelled) return;
    const batch: number[] = [];
    for (let k = 0; k < batchPerFrame && i < totalBlocks; k++, i++) {
      const start = i * blockSize;
      const end = Math.min(start + blockSize, bytes.length);
      batch.push(shannonEntropy(bytes.subarray(start, end)));
    }
    onBatch(batch);
    if (i < totalBlocks) {
      raf = requestAnimationFrame(step);
    } else {
      onDone();
    }
  }
  raf = requestAnimationFrame(step);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}
