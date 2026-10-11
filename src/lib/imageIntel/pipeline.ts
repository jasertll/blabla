// The orchestrating pipeline — ties every real module above into one
// ImageInvestigation. Runs entirely client-side (nothing here contacts
// a server unless the analyst explicitly triggers the reverse-image/
// Reddit/X search actions in the UI, which are separate, opt-in calls —
// see components/imageIntel/ImageIntelWorkspace.tsx). Progress callbacks
// surface each real stage, matching spec section 40's progress list.
import { validateImageBytes } from "./ingestion";
import { computeAllHashes } from "./hashes";
import { decodeImageFile, computePerceptualHashes } from "./imageDecode";
import { extractMetadata } from "./metadata";
import { parseJpegForensics, buildJpegForensicFindings } from "./jpegForensics";
import { runElaAnalysis } from "./elaIntegration";
import type { ElaVerdict } from "../imageForensics";
import { runOcr } from "./ocrEngine";
import { detectFaces } from "./faceDetection";
import { detectObjects } from "./objectDetection";
import type { AnalysisMode, ConfidenceAssessment, EvidenceItem, ImageInvestigation } from "./types";

export type PipelineProgress = { stage: string; pct: number };

function uuid(): string {
  return crypto.randomUUID();
}

const NO_EVIDENCE_YET: ConfidenceAssessment = {
  level: "NOT_MATCHED",
  score: 0,
  explanation: "NO VERIFIED EVIDENCE FOUND. No reverse-image, web, Reddit, or X search has been run yet, and no candidate comparison image has been provided.",
  contributingEvidence: [],
};

export async function runImageInvestigation(
  file: File,
  mode: AnalysisMode,
  onProgress: (p: PipelineProgress) => void = () => {}
): Promise<{ ok: true; investigation: ImageInvestigation } | { ok: false; reason: string }> {
  onProgress({ stage: "Validating file", pct: 2 });
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const ingestion = validateImageBytes(bytes, file.name);
  if (!ingestion.ok) return { ok: false, reason: ingestion.reason };

  onProgress({ stage: "Computing cryptographic hashes", pct: 8 });
  const hashes = await computeAllHashes(buffer);

  onProgress({ stage: "Decoding image", pct: 15 });
  const decoded = await decodeImageFile(file);
  if (!decoded.ok) return { ok: false, reason: decoded.reason };

  const warnings: string[] = [];

  onProgress({ stage: "Extracting metadata", pct: 25 });
  const metadata = await extractMetadata(file);

  onProgress({ stage: "Analyzing JPEG forensics", pct: 32 });
  const jpegForensics = parseJpegForensics(bytes);
  const forensicFindings = buildJpegForensicFindings(jpegForensics);

  onProgress({ stage: "Generating perceptual fingerprints", pct: 40 });
  const fingerprints = computePerceptualHashes(decoded.image);

  onProgress({ stage: "Running error-level analysis", pct: 45 });
  let ela: ElaVerdict | null = null;
  try {
    const wasOriginallyJpeg = ingestion.detectedFormat.mime === "image/jpeg";
    ela = await runElaAnalysis(decoded.image, wasOriginallyJpeg);
  } catch (err) {
    warnings.push(`ELA failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  // OCR runs in every mode, including "fast" — it's the single
  // highest-value, lowest-cost stage (no heavyweight model beyond what
  // this needs anyway) and everything downstream (search-query
  // generation, entity extraction) depends on it.
  let ocr = null;
  let searchQueries: ImageInvestigation["searchQueries"] = [];
  onProgress({ stage: "Running OCR", pct: 50 });
  try {
    const result = await runOcr(decoded.image.canvas, "eng", (pct, msg) => onProgress({ stage: msg, pct: 50 + pct * 0.15 }));
    ocr = result.extraction;
    searchQueries = result.searchQueries;
  } catch (err) {
    warnings.push(`OCR failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  let faces: ImageInvestigation["faces"] = [];
  let objects: ImageInvestigation["objects"] = [];
  if (mode === "balanced" || mode === "deep") {
    onProgress({ stage: "Detecting faces", pct: 68 });
    try {
      faces = await detectFaces(decoded.image.canvas);
    } catch (err) {
      warnings.push(`Face detection failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }

    onProgress({ stage: "Detecting objects", pct: 82 });
    try {
      objects = await detectObjects(decoded.image.canvas);
    } catch (err) {
      warnings.push(`Object detection failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  const evidence: EvidenceItem[] = [
    { sourceEngine: "sha256", description: `SHA-256: ${hashes.sha256}`, confidence: "high" },
    ...jpegForensics.evidence,
    ...forensicFindings.flatMap((f) => f.evidence),
  ];

  onProgress({ stage: "Finalizing investigation", pct: 98 });

  const investigation: ImageInvestigation = {
    investigationId: uuid(),
    createdAt: new Date().toISOString(),
    mode,
    localOnly: true, // flips to false the moment the analyst explicitly runs an external provider search
    image: {
      sha256: hashes.sha256,
      sha1: hashes.sha1,
      md5: hashes.md5,
      fileName: file.name,
      fileSizeBytes: file.size,
      width: decoded.image.width,
      height: decoded.image.height,
      mimeType: file.type || ingestion.detectedFormat.mime,
      declaredExtension: ingestion.declaredExtension,
      detectedFormat: ingestion.detectedFormat.label,
      extensionMismatch: ingestion.extensionMismatch,
      colorMode: null,
      bitDepth: null,
    },
    metadata,
    fingerprints,
    jpegForensics,
    forensicFindings,
    ela,
    ocr,
    searchQueries,
    faces,
    objects,
    reverseImageMatches: { status: "missing_key", provider: "TinEye", envVar: "TINEYE_API_KEY" },
    webResults: { status: "missing_key", provider: "Web Search", envVar: "(no keyless general web-search API exists)" },
    openverseResults: null,
    wikimediaResults: null,
    redditResults: { status: "missing_key", provider: "reddit", envVar: "REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET" },
    xResults: { status: "missing_key", provider: "x", envVar: "X_BEARER_TOKEN" },
    candidateComparison: null,
    evidence,
    confidence: NO_EVIDENCE_YET,
    warnings,
  };

  onProgress({ stage: "Done", pct: 100 });
  return { ok: true, investigation };
}
