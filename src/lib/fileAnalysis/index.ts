// Static file-type/malware-indicator analysis, entirely client-side. Split
// into this directory purely for organization (was previously one
// 639-line file) — every export below is re-exported unchanged, so
// `@/lib/fileAnalysis` still resolves here and no importer needed to
// change.

export { sha256Hex } from "./hash";

export type { FileSignature } from "./signatures";
export { MAGIC_SIGNATURES, detectFileType } from "./signatures";

export type { EntropyProfile } from "./entropy";
export { shannonEntropy, computeEntropyProfile } from "./entropy";

export { extractInterestingStrings } from "./strings";

export type { PdfActiveContentFinding } from "./pdf";
export { extractPdfMetadataBestEffort, scanPdfActiveContent } from "./pdf";

export type { ExtensionCheck } from "./extensionCheck";
export { checkExtensionMismatch } from "./extensionCheck";

export type { EmbeddedFinding, TrailingDataFinding } from "./embedded";
export { scanEmbeddedSignatures, checkTrailingDataAfterEof } from "./embedded";

export type { Severity, Verdict, EvidenceItem } from "./verdicts";
export { worstSeverity, computeRiskScore, buildVerdicts } from "./verdicts";
