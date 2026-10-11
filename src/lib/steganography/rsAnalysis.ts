import type { StegoFinding } from "./types";

// ---------------- RS (Regular-Singular) analysis — Fridrich, Goljan & Du 2001 ----------------
//
// A materially stronger statistical test than a simple pairs-of-values
// check: instead of just looking at whether the LSB plane's value
// distribution looks balanced, RS analysis measures how a 2×2 pixel
// group's local smoothness responds to a controlled LSB flip under two
// complementary masks, and solves a quadratic for the actual embedding
// rate rather than a bare suspicion score. Ported faithfully from the
// reference implementation in StegExpose (github.com/b3dk7/StegExpose,
// RSAnalysis.java — whose header states it "was produced with the aid
// of the authors and has been verified as a correct implementation"),
// rather than re-derived from the paper's prose, to avoid subtle math
// errors. One disclosed simplification: this uses non-overlapping 2×2
// groups (Fridrich's original 2001 formulation) rather than StegExpose's
// overlapping variant, which trades a modest sensitivity gain for
// roughly constant-time-per-pixel performance in the browser.

function negateLsbByte(b: number): number {
  const temp = b & 0xfe;
  return temp === b ? b | 1 : temp;
}

function invertLsbByte(b: number): number {
  if (b === 255) return 256;
  if (b === 256) return 255;
  return negateLsbByte(b + 1) - 1;
}

// f(block) = |p0-p1| + |p3-p2| + |p1-p3| + |p2-p0| for a 2x2 group
// [p0=top-left, p1=top-right, p2=bottom-left, p3=bottom-right] — the
// exact discrimination function from the reference implementation.
function rsVariation(p0: number, p1: number, p2: number, p3: number): number {
  return Math.abs(p0 - p1) + Math.abs(p3 - p2) + Math.abs(p1 - p3) + Math.abs(p2 - p0);
}

const RS_MASK_A = [1, 0, 0, 1] as const; // checkerboard: flip top-left & bottom-right
const RS_MASK_B = [0, 1, 1, 0] as const; // checkerboard: flip top-right & bottom-left

function rsCounts(imageData: ImageData, channelOffset: number, preFlipAll: boolean): { r: number; s: number; rNeg: number; sNeg: number } {
  const { data, width, height } = imageData;
  let r = 0, s = 0, rNeg = 0, sNeg = 0;
  const blocksX = Math.floor(width / 2);
  const blocksY = Math.floor(height / 2);
  const idx = (x: number, y: number) => (y * width + x) * 4 + channelOffset;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const x0 = bx * 2, y0 = by * 2;
      let p0 = data[idx(x0, y0)], p1 = data[idx(x0 + 1, y0)], p2 = data[idx(x0, y0 + 1)], p3 = data[idx(x0 + 1, y0 + 1)];
      if (preFlipAll) { p0 = negateLsbByte(p0); p1 = negateLsbByte(p1); p2 = negateLsbByte(p2); p3 = negateLsbByte(p3); }
      const base = [p0, p1, p2, p3];

      for (const mask of [RS_MASK_A, RS_MASK_B]) {
        const vB = rsVariation(base[0], base[1], base[2], base[3]);
        const f = [
          mask[0] ? negateLsbByte(base[0]) : base[0],
          mask[1] ? negateLsbByte(base[1]) : base[1],
          mask[2] ? negateLsbByte(base[2]) : base[2],
          mask[3] ? negateLsbByte(base[3]) : base[3],
        ];
        const vP = rsVariation(f[0], f[1], f[2], f[3]);
        const nf = [
          mask[0] ? invertLsbByte(base[0]) : base[0],
          mask[1] ? invertLsbByte(base[1]) : base[1],
          mask[2] ? invertLsbByte(base[2]) : base[2],
          mask[3] ? invertLsbByte(base[3]) : base[3],
        ];
        const vN = rsVariation(nf[0], nf[1], nf[2], nf[3]);

        if (vP > vB) r++; else if (vP < vB) s++;
        if (vN > vB) rNeg++; else if (vN < vB) sNeg++;
      }
    }
  }
  return { r, s, rNeg, sNeg };
}

// Solves the RS quadratic 2(d1+d0)x^2 + (d-0-d-1-d1-3d0)x + (d0-d-0) = 0
// for the crossing point x, exactly as in the reference implementation.
function solveRsX(r: number, rNeg: number, r1: number, rNeg1: number, s: number, sNeg: number, s1: number, sNeg1: number): number {
  const d0 = r - s;
  const dNeg0 = rNeg - sNeg;
  const d1 = r1 - s1;
  const dNeg1 = rNeg1 - sNeg1;

  const a = 2 * (d1 + d0);
  const b = dNeg0 - dNeg1 - d1 - 3 * d0;
  const c = d0 - dNeg0;

  if (a === 0) return b !== 0 ? c / b : 0;

  const discriminant = b * b - 4 * a * c;
  if (discriminant >= 0) {
    const sq = Math.sqrt(discriminant);
    const rootPos = (-b + sq) / (2 * a);
    const rootNeg = (-b - sq) / (2 * a);
    return Math.abs(rootPos) <= Math.abs(rootNeg) ? rootPos : rootNeg;
  }
  const denomR = r1 - r + rNeg - rNeg1;
  const denomS = s1 - s + sNeg - sNeg1;
  const cr = denomR !== 0 ? (rNeg - r) / denomR : 0;
  const cs = denomS !== 0 ? (sNeg - s) / denomS : 0;
  return (cr + cs) / 2;
}

export type RsChannelResult = { channel: "R" | "G" | "B"; embeddingRatePercent: number };

/** Runs RS analysis on all three color channels and returns the
 * estimated LSB embedding rate for each — a real quantitative estimate
 * of how much of the image's least-significant-bit capacity is
 * carrying non-natural (likely embedded) data, not just a suspicion
 * score. Returns null for degenerate images (too small for a 2×2
 * group). */
export function analyzeRsSteganalysis(imageData: ImageData): RsChannelResult[] | null {
  if (imageData.width < 2 || imageData.height < 2) return null;
  const channels: { channel: "R" | "G" | "B"; offset: number }[] = [
    { channel: "R", offset: 0 }, { channel: "G", offset: 1 }, { channel: "B", offset: 2 },
  ];
  return channels.map(({ channel, offset }) => {
    const base = rsCounts(imageData, offset, false);
    const allFlipped = rsCounts(imageData, offset, true);
    const x = solveRsX(base.r, base.rNeg, allFlipped.r, allFlipped.rNeg, base.s, base.sNeg, allFlipped.s, allFlipped.sNeg);
    const ml = x - 0.5 === 0 ? 0 : Math.abs(x / (x - 0.5));
    return { channel, embeddingRatePercent: Math.min(100, ml * 100) };
  });
}

export function rsFinding(results: RsChannelResult[]): StegoFinding {
  const avg = results.reduce((a, r) => a + r.embeddingRatePercent, 0) / results.length;
  const breakdown = results.map((r) => `${r.channel}:${r.embeddingRatePercent.toFixed(1)}%`).join(" ");

  const evidence = results.map((r) => ({
    sourceEngine: "rs-steganalysis",
    description: `Channel ${r.channel}: estimated ${r.embeddingRatePercent.toFixed(2)}% LSB embedding rate`,
    confidence: (r.embeddingRatePercent > 8 ? "high" : r.embeddingRatePercent > 2 ? "moderate" : "low") as "high" | "moderate" | "low",
  }));

  if (avg > 8) {
    return {
      id: "rs-strong",
      severity: "danger",
      title: "RS analysis estimates substantial LSB embedding",
      summary: `Estimated LSB embedding rate: ${avg.toFixed(1)}% average (${breakdown}) — well above what an untouched photo shows.`,
      explanation: "RS (Regular-Singular) analysis (Fridrich, Goljan & Du, 2001) is a materially stronger detector than a simple value-balance check — it measures how block smoothness responds to controlled bit flips under two masks and solves directly for the embedding rate, rather than producing a bare suspicion score. An estimate this high is strong quantitative evidence of LSB steganography, largely independent of the specific tool or exact convention used.",
      recommendation: "Combine with the extraction results above — if nothing decoded despite this signal, the data is very likely present but using a channel/bit convention outside what this scanner's extraction brute-force tries.",
      evidence,
    };
  }
  if (avg > 2) {
    return {
      id: "rs-moderate",
      severity: "warning",
      title: "RS analysis estimates a moderate LSB embedding rate",
      summary: `Estimated LSB embedding rate: ${avg.toFixed(1)}% average (${breakdown}).`,
      explanation: "This is above the roughly 0.5% baseline Fridrich's original paper reports for untouched camera/scanner images, but not high enough alone to be conclusive — some processing (heavy JPEG-to-lossless conversion, aggressive denoising) can also elevate this slightly.",
      recommendation: "Treat as a real lead, not a verdict — weigh it alongside the pairs-analysis score and extraction attempts above.",
      evidence,
    };
  }
  return {
    id: "rs-clean",
    severity: "safe",
    title: "RS analysis found no meaningful LSB embedding",
    summary: `Estimated LSB embedding rate: ${avg.toFixed(1)}% average (${breakdown}) — consistent with an untouched image.`,
    explanation: "Fridrich's original paper reports a 'safe' baseline embedding rate below roughly 0.5% for real camera/scanner images — this result is in that range for all three color channels.",
    recommendation: "This specifically rules out naive LSB embedding at any meaningful rate — it doesn't rule out non-LSB techniques (format text chunks, DCT-domain hiding, appended data), which are checked separately above/below.",
    evidence,
  };
}
