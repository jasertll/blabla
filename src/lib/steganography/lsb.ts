import { detectFileType } from "@/lib/fileAnalysis";
import type { StegoFinding } from "./types";
import { packBitsToBytes, printableRatio, tryDecodeUtf8, pairsImbalanceScore } from "./shared";
import { type HiddenPayload, encodeContainer, scanOwnContainer } from "./container";
import { analyzeRsSteganalysis, rsFinding } from "./rsAnalysis";
import { buildExtractionFinding, buildTextExtractionFinding } from "./findingBuilders";

// ---------------- Image LSB steganography ----------------

/** Extracts the least-significant bit of R, G, B (alpha skipped — most
 * embedding tools skip it since it affects visible transparency) from
 * every pixel, row-major, in that channel order. This is by far the
 * most common convention for "simple" LSB steganography tools; a tool
 * using a password-seeded pixel order or a different channel/bit
 * selection won't be recoverable this way, which is called out in the
 * finding text rather than silently failing. */
export function extractLsbBytes(imageData: ImageData): Uint8Array {
  const { data } = imageData; // RGBA, 4 bytes per pixel
  const bits: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    bits.push(data[i] & 1, data[i + 1] & 1, data[i + 2] & 1);
  }
  return packBitsToBytes(bits);
}

/** Embeds a payload into a cover image's pixel LSBs (lossless — the
 * cover must be exported as PNG afterward, since any lossy re-encode
 * destroys LSB data). Works for hiding text OR an entire image/file
 * inside another image. */
export function embedLsbInImage(imageData: ImageData, payload: HiddenPayload): { result: ImageData; usedBytes: number; capacityBytes: number } {
  const container = encodeContainer(payload);
  const capacityBytes = Math.floor((imageData.width * imageData.height * 3) / 8);
  if (container.length > capacityBytes) {
    throw new Error(`Payload too large: needs ${container.length.toLocaleString()} bytes but this cover image can only hold ${capacityBytes.toLocaleString()} bytes. Use a larger cover image or the "append to any file" method instead.`);
  }

  const bits: number[] = [];
  for (const byte of container) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }

  const out = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  const data = out.data;
  let bitIdx = 0;
  for (let i = 0; i < data.length && bitIdx < bits.length; i += 4) {
    if (bitIdx < bits.length) { data[i] = (data[i] & ~1) | bits[bitIdx]; bitIdx++; }
    if (bitIdx < bits.length) { data[i + 1] = (data[i + 1] & ~1) | bits[bitIdx]; bitIdx++; }
    if (bitIdx < bits.length) { data[i + 2] = (data[i + 2] & ~1) | bits[bitIdx]; bitIdx++; }
  }
  return { result: out, usedBytes: container.length, capacityBytes };
}

export function lsbCapacityBytes(width: number, height: number): number {
  return Math.floor((width * height * 3) / 8);
}

export function analyzeImageLsb(imageData: ImageData): StegoFinding[] {
  const findings: StegoFinding[] = [];
  const { data, width, height } = imageData;
  const pixelCount = width * height;

  // Statistical evidence (pairs analysis) — independent of whether we
  // can actually decode anything, this is what tells you "the LSB plane
  // looks tampered with" even for schemes we can't extract.
  const r = new Uint8Array(pixelCount), g = new Uint8Array(pixelCount), b = new Uint8Array(pixelCount);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    r[p] = data[i]; g[p] = data[i + 1]; b[p] = data[i + 2];
  }
  const scores = [pairsImbalanceScore(r), pairsImbalanceScore(g), pairsImbalanceScore(b)];
  const avgScore = scores.reduce((a, v) => a + v, 0) / scores.length;

  if (avgScore < 0.08) {
    findings.push({
      id: "lsb-pairs-strong",
      severity: "danger",
      title: "LSB plane statistics strongly suggest tampering",
      summary: `Pairs-of-values imbalance score: ${avgScore.toFixed(3)} (R:${scores[0].toFixed(2)} G:${scores[1].toFixed(2)} B:${scores[2].toFixed(2)}) — well below what natural photos typically show.`,
      explanation:
        "Naive least-significant-bit embedding makes adjacent pixel-value pairs (e.g. 100 and 101) become roughly equally common, because the bit written no longer depends on the original pixel value. This image's color channels show exactly that pattern — real evidence, though not a certainty; some naturally smooth or already-processed images can occasionally score this low too.",
      recommendation: "Run the LSB extraction below and check whether it recovers a valid file or readable text — that's the confirming step.",
      evidence: [
        { sourceEngine: "lsb-pairs-analysis", description: `R:${scores[0].toFixed(3)} G:${scores[1].toFixed(3)} B:${scores[2].toFixed(3)} channel imbalance scores`, confidence: "high" },
      ],
    });
  } else if (avgScore < 0.18) {
    findings.push({
      id: "lsb-pairs-weak",
      severity: "warning",
      title: "LSB plane statistics show a mild anomaly",
      summary: `Pairs-of-values imbalance score: ${avgScore.toFixed(3)} — lower than most untouched natural photos, but not conclusively so.`,
      explanation: "This is a weaker version of the same pairs-analysis signal — worth checking the extraction results below, but on its own this range overlaps with plenty of ordinary images too.",
      recommendation: "Treat as a lead, not a finding. Check the extraction attempt below before concluding anything.",
      evidence: [
        { sourceEngine: "lsb-pairs-analysis", description: `R:${scores[0].toFixed(3)} G:${scores[1].toFixed(3)} B:${scores[2].toFixed(3)} channel imbalance scores`, confidence: "moderate" },
      ],
    });
  } else {
    findings.push({
      id: "lsb-pairs-clean",
      severity: "safe",
      title: "No LSB tampering pattern detected",
      summary: `Pairs-of-values imbalance score: ${avgScore.toFixed(3)} — consistent with an untouched image's natural statistics.`,
      explanation: "This rules out naive sequential LSB embedding specifically — it does not rule out other steganography techniques (DCT-domain hiding in JPEGs, palette-based tricks in GIFs/PNGs, or password-seeded pixel ordering).",
      recommendation: "If you have a specific reason to suspect this file, also check the Embedded/Trailing Data and Zero-Width Text sections.",
      evidence: [
        { sourceEngine: "lsb-pairs-analysis", description: `R:${scores[0].toFixed(3)} G:${scores[1].toFixed(3)} B:${scores[2].toFixed(3)} channel imbalance scores`, confidence: "high" },
      ],
    });
  }

  // RS analysis (Fridrich, Goljan & Du 2001) — a materially stronger,
  // quantitative statistical test than the pairs check above; run it
  // independently so a weak pairs-analysis result doesn't hide a real
  // RS-detected embedding rate (and vice versa).
  const rsResults = analyzeRsSteganalysis(imageData);
  if (rsResults) findings.push(rsFinding(rsResults));

  // Extraction attempt — this is the part that can produce an actual
  // recovered artifact, not just a suspicion score.
  const extractedBytes = extractLsbBytes(imageData);

  // Check for THIS tool's own container first — a guaranteed-exact
  // recovery if the Hide feature was used, before falling back to
  // guessing at third-party tools' conventions below.
  const ownContainer = scanOwnContainer(extractedBytes, "image LSB");
  if (ownContainer.length > 0) return [...findings, ...ownContainer];

  // Strategy 1: a 32-bit big-endian length prefix (the most common
  // convention among simple LSB tools) followed by that many bytes.
  if (extractedBytes.length > 4) {
    const declaredLen = (extractedBytes[0] << 24) | (extractedBytes[1] << 16) | (extractedBytes[2] << 8) | extractedBytes[3];
    if (declaredLen > 0 && declaredLen <= extractedBytes.length - 4 && declaredLen < 50_000_000) {
      const payload = extractedBytes.subarray(4, 4 + declaredLen);
      const asFile = detectFileType(payload);
      const text = tryDecodeUtf8(payload);
      const isPrintable = text !== null && printableRatio(payload) > 0.85;

      if (asFile) {
        findings.push(buildExtractionFinding("lsb-header-file", asFile, payload));
      } else if (isPrintable && text) {
        findings.push(buildTextExtractionFinding("lsb-header-text", text, "a length-prefixed LSB payload (32-bit header)"));
      }
    }
  }

  // Strategy 2: no header — raw bytes starting immediately, either a
  // recognizable file signature or a long printable-text run.
  const asFileNoHeader = detectFileType(extractedBytes);
  if (asFileNoHeader) {
    findings.push(buildExtractionFinding("lsb-raw-file", asFileNoHeader, extractedBytes));
  } else {
    const textAttempt = tryDecodeUtf8(extractedBytes.subarray(0, Math.min(extractedBytes.length, 20_000)));
    if (textAttempt) {
      const nullIdx = textAttempt.indexOf(" ");
      const candidate = nullIdx > 8 ? textAttempt.slice(0, nullIdx) : textAttempt.slice(0, 2000);
      const ratio = printableRatio(new TextEncoder().encode(candidate));
      if (candidate.trim().length >= 8 && ratio > 0.9) {
        findings.push(buildTextExtractionFinding("lsb-raw-text", candidate, "the raw LSB bitstream (no length header assumed)"));
      }
    }
  }

  if (!findings.some((f) => f.extracted)) {
    findings.push({
      id: "lsb-no-extraction",
      severity: "info",
      title: "No valid payload recovered via common LSB conventions",
      summary: "Neither a length-prefixed nor a raw LSB extraction produced a recognizable file or readable text.",
      explanation: "This doesn't rule out LSB steganography — it means whatever is there (if anything) doesn't follow the length-header or raw-bytes conventions this scanner tries, or isn't in the LSB plane of R/G/B at all.",
      recommendation: "If the pairs-analysis result above was flagged, the data is very likely there but embedded with a different convention (different bit order, channel selection, or a password-seeded pixel path) — a tool like StegSolve or zsteg that supports many more extraction strategies would be the next step.",
    });
  }

  return findings;
}
