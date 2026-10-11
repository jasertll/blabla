// Transparent, weighted evidence scoring for comparing the investigated
// image against a candidate image the analyst supplies (see
// localFeatureMatch.ts and the "Candidate Comparison" workspace tab).
// Every number here is explainable — see explainMatch() — and the
// thresholds below ARE the definition of each confidence band (spec
// section 25: "define exactly what evidence threshold causes each
// state"), not an opaque black box.
import type { EvidenceItem } from "../evidenceModel";
import type { ConfidenceAssessment, ConfidenceLevel, FingerprintComparison, LocalFeatureMatchResult } from "./types";

export type MatchScoringInput = {
  exactHashMatch: boolean; // SHA-256 identical
  fingerprintComparison: FingerprintComparison;
  localFeatureMatch: LocalFeatureMatchResult | null;
  ocrOverlapRatio: number | null; // 0-1, fraction of shared distinctive OCR terms
};

const PERCEPTUAL_WEIGHT: Record<FingerprintComparison["verdict"], number> = {
  identical: 40,
  "near-identical": 30,
  "likely-related": 18,
  "possibly-related": 8,
  unrelated: 0,
};

/** Weights are configurable constants, not magic numbers scattered
 * through the scoring logic — change these to retune without touching
 * the scoring algorithm itself (spec section 24: "Make weights
 * configurable"). */
export const SCORING_WEIGHTS = {
  exactHash: 100, // SHA-256 match is definitive on its own
  perceptual: PERCEPTUAL_WEIGHT,
  geometricStrong: 35, // homography found, high inlier ratio
  geometricModerate: 15, // homography found, moderate inlier ratio
  ocrOverlapMax: 15,
};

export function scoreCandidateMatch(input: MatchScoringInput): ConfidenceAssessment {
  const evidence: EvidenceItem[] = [];
  let score = 0;

  if (input.exactHashMatch) {
    score += SCORING_WEIGHTS.exactHash;
    evidence.push({ sourceEngine: "sha256-comparison", description: "SHA-256 hashes are byte-for-byte identical", confidence: "high" });
  }

  const pWeight = SCORING_WEIGHTS.perceptual[input.fingerprintComparison.verdict];
  if (pWeight > 0) {
    score += pWeight;
    evidence.push({
      sourceEngine: "perceptual-hash-comparison",
      description: `pHash distance ${input.fingerprintComparison.pHashDistance}, dHash distance ${input.fingerprintComparison.dHashDistance}, aHash distance ${input.fingerprintComparison.aHashDistance} (${input.fingerprintComparison.verdict})`,
      confidence: input.fingerprintComparison.verdict === "identical" || input.fingerprintComparison.verdict === "near-identical" ? "high" : "moderate",
    });
  }

  if (input.localFeatureMatch && input.localFeatureMatch.status === "ok") {
    const lfm = input.localFeatureMatch;
    if (lfm.geometricallyConsistent && lfm.inlierRatio >= 0.5) {
      score += SCORING_WEIGHTS.geometricStrong;
      evidence.push({
        sourceEngine: "orb-ransac-matcher",
        description: `${lfm.inlierCount} geometrically-consistent keypoint inliers out of ${lfm.goodMatches} good matches (${(lfm.inlierRatio * 100).toFixed(0)}% inlier ratio) — a valid homography was found`,
        confidence: "high",
      });
    } else if (lfm.geometricallyConsistent && lfm.inlierRatio >= 0.2) {
      score += SCORING_WEIGHTS.geometricModerate;
      evidence.push({
        sourceEngine: "orb-ransac-matcher",
        description: `${lfm.inlierCount} geometrically-consistent inliers out of ${lfm.goodMatches} good matches (${(lfm.inlierRatio * 100).toFixed(0)}% inlier ratio) — a homography was found but with a weaker inlier ratio`,
        confidence: "moderate",
      });
    } else if (lfm.goodMatches > 0) {
      evidence.push({
        sourceEngine: "orb-ransac-matcher",
        description: `${lfm.goodMatches} good keypoint matches found, but no geometrically-consistent homography — consistent with coincidental local similarity, not the same underlying scene/object`,
        confidence: "low",
      });
    }
  }

  if (input.ocrOverlapRatio !== null && input.ocrOverlapRatio > 0) {
    const contribution = input.ocrOverlapRatio * SCORING_WEIGHTS.ocrOverlapMax;
    score += contribution;
    evidence.push({
      sourceEngine: "ocr-text-overlap",
      description: `${(input.ocrOverlapRatio * 100).toFixed(0)}% of distinctive OCR terms shared between the two images`,
      confidence: input.ocrOverlapRatio > 0.7 ? "high" : "moderate",
    });
  }

  // Clamped to 100: an exact hash match (100 on its own) will always also
  // trigger the perceptual/geometric/OCR bonuses (identical bytes imply
  // identical pixels imply identical derived signals), which would
  // otherwise stack past 100 and print a nonsensical "140/100" — the
  // individual weights below 100 are already designed to sum to at most
  // 90 for the non-exact-match case, so this clamp only ever affects the
  // exact-match path.
  const clampedScore = Math.min(100, Math.round(score));
  const level = classifyScore(score, input);
  return { level, score: clampedScore, explanation: explainMatch(level, clampedScore, evidence, input), contributingEvidence: evidence };
}

/** The exact thresholds that define each confidence band — see spec
 * section 25. VERIFIED is reserved for an exact hash match (nothing
 * short of byte-identical content earns it); everything else is scored
 * on the 0-100 weighted scale above. */
function classifyScore(score: number, input: MatchScoringInput): ConfidenceLevel {
  if (input.exactHashMatch) return "VERIFIED";
  if (score >= 60) return "HIGH_CONFIDENCE";
  if (score >= 35) return "PROBABLE";
  if (score >= 15) return "POSSIBLE";
  if (score > 0) return "UNCONFIRMED";
  return "NOT_MATCHED";
}

const LEVEL_LABEL: Record<ConfidenceLevel, string> = {
  VERIFIED: "VERIFIED",
  HIGH_CONFIDENCE: "HIGH CONFIDENCE",
  PROBABLE: "PROBABLE",
  POSSIBLE: "POSSIBLE",
  UNCONFIRMED: "UNCONFIRMED",
  NOT_MATCHED: "NOT MATCHED",
};

function explainMatch(level: ConfidenceLevel, score: number, evidence: EvidenceItem[], input: MatchScoringInput): string {
  if (level === "NOT_MATCHED") {
    return "NO VERIFIED EVIDENCE FOUND. No hash match, no meaningful perceptual-hash similarity, and no geometrically-consistent local-feature match were found between these two images.";
  }
  const signals = evidence.map((e) => `${e.description} (${e.sourceEngine}, ${e.confidence} confidence)`).join("; ");
  const conclusion =
    level === "VERIFIED"
      ? "The two files are byte-for-byte identical."
      : level === "HIGH_CONFIDENCE"
      ? "Strong evidence that the candidate is the same underlying image (possibly modified/recompressed/resized)."
      : level === "PROBABLE"
      ? "Several independent signals point the same direction — probably related, though not conclusively."
      : level === "POSSIBLE"
      ? "Weak but non-zero evidence of a relationship — worth a closer manual look, not a confirmed match."
      : "Minimal evidence found — treat as unconfirmed rather than a real lead.";
  return `MATCH: ${LEVEL_LABEL[level]} (score ${Math.round(score)}/100)\nEvidence: ${signals || "none"}\nConclusion: ${conclusion}`;
}
