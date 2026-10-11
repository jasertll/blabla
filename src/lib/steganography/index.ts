// Real steganography detection + best-effort extraction, entirely
// client-side. Split into this directory (was previously one 1223-line
// file) purely for organization — every export below is re-exported
// unchanged, so `@/lib/steganography` still resolves here and no
// importer needed to change. See types.ts for the two things worth
// being upfront about with every finding this module produces.

export type { Severity, ExtractedPayload, StegoFinding } from "./types";

export type { HiddenPayload } from "./container";
export { encodeContainer, embedByAppending, scanOwnContainer } from "./container";

export { pairsImbalanceScore, hasRealTransparency } from "./shared";

export type { RsChannelResult } from "./rsAnalysis";
export { analyzeRsSteganalysis } from "./rsAnalysis";

export { extractLsbBytes, embedLsbInImage, lsbCapacityBytes, analyzeImageLsb } from "./lsb";

export { scanZeroWidthSteganography } from "./zeroWidth";

export { extractFileInFile } from "./fileInFile";

export { findWavDataChunk, analyzeWavLsb } from "./audioLsb";

export { bruteForceLsbScan } from "./bruteForce";

export { scanPngTextChunks, scanJpegComments, scanId3Comments } from "./formatMetadata";

export { deepScanStrings } from "./stringsScan";
