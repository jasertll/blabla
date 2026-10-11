export type ElaBlock = { row: number; col: number; intensity: number; region: string };

export type ElaVerdict = {
  verdict: "likely-original" | "possible-modification" | "strong-signs-of-modification" | "inconclusive";
  headline: string;
  explanation: string;
  hotspotRegions: string[];
  hotspotRatio: number;
  blocks: ElaBlock[];
};

const REGION_NAMES = [
  ["top-left", "top-center", "top-right"],
  ["middle-left", "center", "middle-right"],
  ["bottom-left", "bottom-center", "bottom-right"],
];

function regionFor(colFrac: number, rowFrac: number): string {
  const col = colFrac < 1 / 3 ? 0 : colFrac < 2 / 3 ? 1 : 2;
  const row = rowFrac < 1 / 3 ? 0 : rowFrac < 2 / 3 ? 1 : 2;
  return REGION_NAMES[row][col];
}

/**
 * Divides the raw (un-amplified) pixel difference between the original
 * and resaved-JPEG images into a grid, scores each block's average error,
 * and flags blocks that are statistical outliers (mean + 2*stddev) as
 * likely-edited hotspots. This is a heuristic — not a forensic-grade
 * detector — so the wording stays hedged throughout.
 */
export function analyzeEla(
  originalData: ImageData,
  resavedData: ImageData,
  wasOriginallyJpeg: boolean
): ElaVerdict {
  const { width, height } = originalData;
  const gridSize = Math.max(6, Math.min(14, Math.floor(Math.min(width, height) / 40)));
  const blockW = Math.ceil(width / gridSize);
  const blockH = Math.ceil(height / gridSize);

  const blockSums: number[][] = Array.from({ length: gridSize }, () => Array(gridSize).fill(0));
  const blockCounts: number[][] = Array.from({ length: gridSize }, () => Array(gridSize).fill(0));

  for (let y = 0; y < height; y++) {
    const row = Math.min(gridSize - 1, Math.floor(y / blockH));
    for (let x = 0; x < width; x++) {
      const col = Math.min(gridSize - 1, Math.floor(x / blockW));
      const i = (y * width + x) * 4;
      const diff =
        Math.abs(originalData.data[i] - resavedData.data[i]) +
        Math.abs(originalData.data[i + 1] - resavedData.data[i + 1]) +
        Math.abs(originalData.data[i + 2] - resavedData.data[i + 2]);
      blockSums[row][col] += diff;
      blockCounts[row][col] += 1;
    }
  }

  const blocks: ElaBlock[] = [];
  const intensities: number[] = [];
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const avg = blockCounts[row][col] > 0 ? blockSums[row][col] / blockCounts[row][col] : 0;
      intensities.push(avg);
      blocks.push({
        row,
        col,
        intensity: avg,
        region: regionFor((col + 0.5) / gridSize, (row + 0.5) / gridSize),
      });
    }
  }

  const mean = intensities.reduce((a, b) => a + b, 0) / intensities.length;
  const variance = intensities.reduce((a, b) => a + (b - mean) ** 2, 0) / intensities.length;
  const stddev = Math.sqrt(variance);
  const threshold = mean + 2 * stddev;

  const hotspots = blocks.filter((b) => b.intensity > threshold && b.intensity > 4);
  const hotspotRatio = hotspots.length / blocks.length;
  const hotspotRegions = Array.from(new Set(hotspots.map((b) => b.region)));

  if (!wasOriginallyJpeg) {
    return {
      verdict: "inconclusive",
      headline: "INCONCLUSIVE — source wasn't a JPEG",
      explanation:
        "This file wasn't originally a JPEG (or its format couldn't be confirmed), so there's no prior JPEG compression history to compare against — every region gets compressed for the first time during this analysis, which makes ELA unreliable here. ELA only works meaningfully on images that started as JPEGs.",
      hotspotRegions: [],
      hotspotRatio: 0,
      blocks,
    };
  }

  // Small, tightly localized outlier — the classic ELA signature of a
  // pasted/cloned/re-edited region. Strongest of the four categories.
  if (hotspotRegions.length > 0 && hotspotRatio < 0.15) {
    return {
      verdict: "strong-signs-of-modification",
      headline: `STRONG SIGNS OF MODIFICATION — ${hotspotRegions.join(", ")}`,
      explanation: `${hotspots.length} of ${blocks.length} grid blocks (${(hotspotRatio * 100).toFixed(0)}%) show a compression-error level well above the rest of the image, tightly concentrated in the ${hotspotRegions.join(" and ")} region${hotspotRegions.length > 1 ? "s" : ""}. This pattern — a small, localized area with a different error level than its surroundings — is the classic ELA signature of a pasted, cloned, or re-edited region. It is not proof: the same pattern can also appear from a heavily-saved crop, a sticker/text overlay added by the camera app, or a legitimately high-detail area (fine text, sharp edges). Treat this as a lead to examine that region more closely, not a final verdict.`,
      hotspotRegions,
      hotspotRatio,
      blocks,
    };
  }

  // Broader or less-concentrated elevated error — worth a look but not the
  // tight single-region signature above.
  if (hotspotRatio >= 0.15) {
    return {
      verdict: "possible-modification",
      headline: "POSSIBLE MODIFICATION",
      explanation:
        hotspotRatio >= 0.35
          ? `Elevated error is spread broadly across ${(hotspotRatio * 100).toFixed(0)}% of the image rather than concentrated in one area. This is more consistent with the whole image having been resaved/recompressed (e.g. re-exported, screenshotted, or downloaded and re-uploaded) than with a single edited region — but it does mean ELA can't isolate a specific manipulated area here.`
          : `${hotspots.length} of ${blocks.length} grid blocks show above-average error across ${hotspotRegions.length > 1 ? "several regions" : "a broader area"} rather than one tight spot. Less diagnostic than a single concentrated hotspot, but still worth a closer look at ${hotspotRegions.join(", ") || "the flagged areas"}.`,
      hotspotRegions,
      hotspotRatio,
      blocks,
    };
  }

  return {
    verdict: "likely-original",
    headline: "LIKELY ORIGINAL",
    explanation:
      "The compression-error level is fairly uniform across the image, with no region standing out as a statistical outlier. This is consistent with an unedited (or at least un-recompressed-in-parts) JPEG, though ELA cannot detect every kind of manipulation (e.g. global filters, AI-generated images, or edits saved at the exact same JPEG quality as the original).",
    hotspotRegions: [],
    hotspotRatio,
    blocks,
  };
}
