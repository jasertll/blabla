// Shared schema for the Image Threat Intelligence investigation pipeline.
// Every stage below produces a typed, evidence-backed structure — nothing
// here is free text with no provenance. Reuses this platform's existing
// EvidenceItem (lib/evidenceModel.ts, already shared by File Inspector,
// Steganography, PCAP) and ProviderState (lib/osintTypes.ts, already used
// by every OSINT lookup route) instead of inventing parallel shapes.
import type { EvidenceItem } from "../evidenceModel";
import type { ProviderState } from "../osintTypes";
import type { ElaVerdict } from "../imageForensics";

export type { ElaVerdict };

export type { EvidenceItem, ProviderState };

// ---------- Confidence classification ----------
// Six explicit bands, each with a fixed meaning (see evidenceScoring.ts
// for the exact thresholds) — never a bare percentage presented as
// certainty. "NOT_MATCHED" and "UNCONFIRMED" are both legitimate,
// expected outcomes, not failures.
export type ConfidenceLevel = "VERIFIED" | "HIGH_CONFIDENCE" | "PROBABLE" | "POSSIBLE" | "UNCONFIRMED" | "NOT_MATCHED";

export type ConfidenceAssessment = {
  level: ConfidenceLevel;
  score: number; // raw weighted evidence score — see evidenceScoring.ts
  explanation: string;
  contributingEvidence: EvidenceItem[];
};

// ---------- Image identity ----------
export type ImageIdentity = {
  sha256: string;
  sha1: string;
  md5: string;
  fileName: string;
  fileSizeBytes: number;
  width: number;
  height: number;
  mimeType: string;
  declaredExtension: string;
  detectedFormat: string | null; // from magic-byte signature, independent of extension/MIME
  extensionMismatch: boolean;
  colorMode: string | null;
  bitDepth: number | null;
};

// ---------- Metadata forensics ----------
export type MetadataField = { key: string; value: string; category: "exif" | "xmp" | "iptc" | "icc" | "other" };

export type GpsEvidence = {
  source: "exif-gps"; // kept distinct from any future visual-inference field on purpose — see spec section 2
  latitude: number;
  longitude: number;
  altitude: number | null;
  timestamp: string | null;
};

export type MetadataReport = {
  status: "found" | "absent" | "inconsistent";
  fields: MetadataField[];
  gps: GpsEvidence | null;
  camera: { make: string | null; model: string | null; lens: string | null; software: string | null };
  timestamps: { original: string | null; digitized: string | null; modified: string | null };
  orientation: number | null;
  inconsistencyNotes: string[]; // e.g. "Modify date earlier than Create date"
};

// ---------- Perceptual fingerprints ----------
export type PerceptualHashes = {
  aHash: string; // 64-bit average hash, hex
  dHash: string; // 64-bit difference hash, hex
  pHash: string; // 64-bit DCT-based perceptual hash, hex
};

export type FingerprintComparison = {
  aHashDistance: number;
  dHashDistance: number;
  pHashDistance: number;
  // Lower = more similar. 0 = identical hash. >20 (of 64 bits) is
  // generally unrelated images — see evidenceScoring.ts for the bands
  // this feeds into.
  verdict: "identical" | "near-identical" | "likely-related" | "possibly-related" | "unrelated";
};

// ---------- JPEG / forensic analysis ----------
export type JpegQuantizationTable = { id: number; precision: number; values: number[] };

export type JpegForensics = {
  applicable: boolean;
  reason?: string; // populated when applicable === false (e.g. "not a JPEG")
  quantizationTables: JpegQuantizationTable[];
  multipleTableSetsFound: boolean; // >1 distinct DQT segment set = recompression signal
  estimatedQualityByTable: number[]; // one rough JPEG-quality estimate per table, from its mean scaling
  progressive: boolean;
  evidence: EvidenceItem[];
};

export type ForensicFinding = {
  id: string;
  title: string;
  severity: "info" | "notable" | "significant";
  explanation: string;
  confidence: "low" | "moderate" | "high";
  evidence: EvidenceItem[];
};

// ---------- OCR ----------
export type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };

export type OcrExtraction = {
  rawText: string;
  normalizedText: string;
  meanConfidence: number;
  words: OcrWord[];
  usernames: string[];
  urls: string[];
  domains: string[];
  emails: string[];
  hashtags: string[];
  phoneNumbers: string[];
};

export type SearchQueryCandidate = {
  query: string;
  type: "ocr-exact-phrase" | "username" | "url" | "domain" | "hashtag" | "image-full" | "image-region";
  reason: string;
  priority: number; // higher = search first; see providers.ts QueryPrioritizationEngine
};

// ---------- Face analysis (quality/structure only — never identity) ----------
export type FaceDetection = {
  id: string;
  bbox: { x: number; y: number; width: number; height: number };
  landmarks: { rightEye: [number, number]; leftEye: [number, number]; nose: [number, number]; mouth: [number, number]; rightEar: [number, number]; leftEar: [number, number] };
  detectionConfidence: number;
  qualityScore: number; // 0-100, see faceDetection.ts for the formula
  blurScore: number; // Laplacian-variance based; higher = sharper
  resolutionPx: number; // bbox width * height
  brightnessEstimate: number; // 0-255 mean luma of the face crop
  estimatedYaw: "frontal" | "left-profile" | "right-profile" | "unknown";
  cropDataUrl: string;
};

// ---------- Object detection ----------
export type ObjectDetection = {
  id: string;
  className: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
  model: "coco-ssd";
  cropDataUrl: string;
};

// ---------- Local feature matching (candidate comparison) ----------
export type LocalFeatureMatchResult = {
  status: "ok" | "insufficient-features" | "error";
  message?: string;
  keypointsA: number;
  keypointsB: number;
  goodMatches: number;
  goodMatchRatio: number;
  inlierCount: number;
  inlierRatio: number;
  geometricallyConsistent: boolean; // homography found with enough inliers
  matchPreviewDataUrl: string | null;
};

// ---------- Reverse-image / web / social providers ----------
export type ReverseImageMatch = {
  provider: string;
  resultUrl: string;
  canonicalUrl: string;
  domain: string;
  title: string | null;
  snippet: string | null;
  matchedImageUrl: string | null;
  publicationDate: string | null;
  retrievalDate: string;
  matchType: "exact" | "cropped" | "edited" | "resized" | "visually-similar";
  providerScore: number | null;
};

export type WebResult = {
  provider: string;
  sourceUrl: string;
  domain: string;
  sourceClass: "SOCIAL" | "NEWS" | "FORUM" | "BLOG" | "IMAGE_HOST" | "MARKETPLACE" | "TECHNICAL" | "ORGANIZATION" | "PERSONAL_SITE" | "OTHER";
  title: string | null;
  snippet: string | null;
  publicationDate: string | null;
  retrievalDate: string;
  matchedTerms: string[];
};

export type RedditResult = {
  redditPostId: string;
  subreddit: string;
  author: string | null;
  title: string;
  bodySnippet: string | null;
  createdAt: string;
  permalink: string;
  matchedTerms: string[];
  provider: "reddit";
  retrievalTime: string;
};

export type XResult = {
  postId: string;
  authorHandle: string | null;
  createdAt: string;
  postUrl: string;
  text: string;
  mediaRefs: string[];
  matchedTerms: string[];
  provider: "x";
  retrievalTime: string;
};

// ---------- Investigation report root ----------
export type AnalysisMode = "fast" | "balanced" | "deep";

export type ImageInvestigation = {
  investigationId: string;
  createdAt: string;
  mode: AnalysisMode;
  localOnly: boolean; // true = no external provider ever contacted
  image: ImageIdentity;
  metadata: MetadataReport;
  fingerprints: PerceptualHashes;
  jpegForensics: JpegForensics;
  forensicFindings: ForensicFinding[];
  ela: ElaVerdict | null;
  ocr: OcrExtraction | null;
  searchQueries: SearchQueryCandidate[];
  faces: FaceDetection[];
  objects: ObjectDetection[];
  reverseImageMatches: ProviderState<ReverseImageMatch[]>;
  webResults: ProviderState<WebResult[]>;
  // Real, keyless, text-query providers — distinct from webResults
  // above, which represents a general public web-search API that
  // genuinely doesn't exist in free/keyless form (see the session
  // report). These two do exist for real, with no key required, so
  // `null` (not a ProviderState) means "not searched yet" rather than
  // a missing-key excuse that would be false for a keyless provider.
  openverseResults: ProviderState<WebResult[]> | null;
  wikimediaResults: ProviderState<WebResult[]> | null;
  redditResults: ProviderState<RedditResult[]>;
  xResults: ProviderState<XResult[]>;
  candidateComparison: LocalFeatureMatchResult | null;
  evidence: EvidenceItem[];
  confidence: ConfidenceAssessment;
  warnings: string[]; // e.g. "decompression-bomb guard triggered", "EXIF parse failed"
};
