import type { GenomeRegion } from "@/lib/fileGenome";

// Same green→red entropy ramp used across every file-analysis tool in
// this app (File Inspector's entropy bar, the old DNA helix) — kept
// identical here so a color means the same thing everywhere.
export function entropyColor(bits: number): string {
  const hue = Math.max(0, 130 - (bits / 8) * 130);
  return `hsl(${hue}, 75%, 55%)`;
}

/** Picks up to `cap` REAL regions spread evenly across the file, rather
 * than averaging groups together — every node/point downstream always
 * corresponds to one genuine, inspectable region with real metadata,
 * never a blended fake one. Full-resolution heatmaps don't need this;
 * discrete node/graph/3D views do, for both clarity and performance. */
export function sampleRegions(regions: GenomeRegion[], cap: number): GenomeRegion[] {
  if (regions.length <= cap) return regions;
  const out: GenomeRegion[] = [];
  const step = regions.length / cap;
  for (let i = 0; i < cap; i++) {
    out.push(regions[Math.min(regions.length - 1, Math.floor(i * step))]);
  }
  return out;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
