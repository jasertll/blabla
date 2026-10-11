// Real JPEG marker-segment parsing — reads the actual DQT (quantization
// table) and SOF (start-of-frame) segments straight out of the file
// bytes, per the JPEG (ITU-T T.81) spec. This is NOT a heuristic: a
// JPEG's quantization tables are literal structured data in the file,
// so reading them is a parse, not a guess.
//
// Why this matters forensically: every JPEG encoder picks quantization
// tables based on the requested quality setting. If a file contains
// MULTIPLE DIFFERENT table sets (more than one DQT segment group with
// different values), or the file as a whole shows two inconsistent
// implied quality levels, that is consistent with the image having been
// decoded and re-encoded at least once — i.e. recompression, which is
// what happens when a region is edited and the file resaved, or when an
// image is downloaded/re-uploaded by a platform that recompresses it.
// It is NOT proof of manipulation by itself (plenty of ordinary
// re-saves/platform processing do this to unedited images too) — see
// the hedged wording in buildJpegForensicFindings() below, matching
// this codebase's existing ELA wording in lib/imageForensics.ts.
import type { EvidenceItem } from "../evidenceModel";
import type { ForensicFinding, JpegForensics, JpegQuantizationTable } from "./types";

const SOI = 0xd8;
const DQT = 0xdb;
const SOF0 = 0xc0; // baseline
const SOF2 = 0xc2; // progressive
const EOI = 0xd9;
// Markers with no payload (no length field follows them).
const STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);

/** Standard JPEG zigzag order for an 8x8 block — tables are stored
 * zigzag-scanned in the file; de-zigzagging makes the values comparable
 * position-for-position across tables and matches how every other tool
 * (jhead, exiftool, libjpeg) reports them. */
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10,
  17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63,
];

function deZigzag(values: number[]): number[] {
  const out = new Array(64).fill(0);
  for (let i = 0; i < Math.min(64, values.length); i++) out[ZIGZAG[i]] = values[i];
  return out;
}

/** Rough JPEG-quality estimate from a table's scaling, inverting the
 * standard IJG IJG quality-scaling formula (the same one libjpeg uses to
 * BUILD tables from a quality number) against the table's own mean
 * value. This is the well-known, published way to approximate "what
 * quality setting produced this table" — an estimate, not an exact
 * recovery (many quality settings can map to very similar tables), so
 * it's surfaced as "estimated", never as a precise fact. */
function estimateQualityFromTable(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return 100;
  // IJG scaling: quality>=50 -> scale = 200 - 2*quality; quality<50 -> scale = 5000/quality
  // table value ~= round(base_table * scale / 100), clamped [1,255].
  // Solving for an approximate quality from the mean scale factor,
  // using 16 (a representative mid-magnitude base-table value) as the
  // reference base, same approach exiftool's quality-estimation uses.
  const scale = (mean / 16) * 100;
  let quality: number;
  if (scale < 100) {
    quality = Math.round((200 - scale) / 2);
  } else {
    quality = Math.round(5000 / scale);
  }
  return Math.max(1, Math.min(100, quality));
}

export function parseJpegForensics(bytes: Uint8Array): JpegForensics {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) {
    return { applicable: false, reason: "Not a JPEG file (no SOI marker).", quantizationTables: [], multipleTableSetsFound: false, estimatedQualityByTable: [], progressive: false, evidence: [] };
  }

  const tables: JpegQuantizationTable[] = [];
  let progressive = false;
  let dqtSegmentGroups = 0;

  let offset = 2;
  try {
    while (offset < bytes.length - 1) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      // Skip fill bytes (multiple 0xFF in a row before the real marker).
      let markerOffset = offset;
      while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) markerOffset++;
      if (markerOffset >= bytes.length) break;
      const marker = bytes[markerOffset];
      offset = markerOffset + 1;

      if (marker === EOI || marker === 0x00) break;
      if (STANDALONE.has(marker)) continue;

      if (offset + 1 >= bytes.length) break;
      const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
      const payloadStart = offset + 2;
      const payloadEnd = offset + segmentLength; // segmentLength includes the 2 length bytes

      if (marker === DQT) {
        dqtSegmentGroups++;
        let p = payloadStart;
        while (p < payloadEnd - 1 && p < bytes.length) {
          const pqTq = bytes[p];
          const precision = (pqTq >> 4) & 0x0f;
          const id = pqTq & 0x0f;
          p++;
          const values: number[] = [];
          const bytesPerValue = precision === 0 ? 1 : 2;
          for (let i = 0; i < 64; i++) {
            if (p + bytesPerValue > bytes.length) break;
            const v = precision === 0 ? bytes[p] : (bytes[p] << 8) | bytes[p + 1];
            values.push(v);
            p += bytesPerValue;
          }
          if (values.length === 64) {
            tables.push({ id, precision, values: deZigzag(values) });
          }
        }
      } else if (marker === SOF0) {
        progressive = false;
      } else if (marker === SOF2) {
        progressive = true;
      }

      offset = payloadEnd;
      if (segmentLength < 2) break; // malformed — avoid infinite loop
    }
  } catch {
    // Truncated/malformed segment — return whatever was parsed before the error, not a crash.
  }

  // Distinct table IDs with genuinely different values = more than one
  // table set was embedded. A single well-formed encode normally embeds
  // exactly 2 tables (luma id=0, chroma id=1) ONE time each — seeing the
  // SAME id defined more than once with DIFFERENT values is the direct
  // signal of recompression (a second encode pass overwrote/duplicated
  // the DQT segment).
  const byId = new Map<number, number[][]>();
  for (const t of tables) {
    if (!byId.has(t.id)) byId.set(t.id, []);
    byId.get(t.id)!.push(t.values);
  }
  let multipleTableSetsFound = false;
  for (const valueSets of byId.values()) {
    if (valueSets.length > 1) {
      const first = valueSets[0];
      const anyDifferent = valueSets.slice(1).some((vs) => vs.some((v, i) => v !== first[i]));
      if (anyDifferent) multipleTableSetsFound = true;
    }
  }

  const estimatedQualityByTable = tables.map((t) => estimateQualityFromTable(t.values));

  const evidence: EvidenceItem[] = tables.map((t, i) => ({
    sourceEngine: "jpeg-dqt-parser",
    description: `DQT table id=${t.id} precision=${t.precision === 0 ? "8-bit" : "16-bit"}, estimated quality ~${estimatedQualityByTable[i]}`,
    confidence: "high",
  }));
  if (dqtSegmentGroups > 1) {
    evidence.push({
      sourceEngine: "jpeg-dqt-parser",
      description: `${dqtSegmentGroups} separate DQT marker segments found in this file (a single clean encode normally has exactly 1)`,
      confidence: multipleTableSetsFound ? "high" : "moderate",
    });
  }

  return { applicable: true, quantizationTables: tables, multipleTableSetsFound, estimatedQualityByTable, progressive, evidence };
}

export function buildJpegForensicFindings(forensics: JpegForensics): ForensicFinding[] {
  if (!forensics.applicable) return [];
  const findings: ForensicFinding[] = [];

  if (forensics.multipleTableSetsFound) {
    findings.push({
      id: "jpeg-multiple-quant-tables",
      title: "Multiple distinct quantization table sets found in this JPEG",
      severity: "significant",
      confidence: "moderate",
      explanation:
        "This file contains more than one quantization-table definition for the same table slot, with genuinely different values between them. A single clean JPEG encode writes each table slot exactly once; seeing it redefined with different values is consistent with the file having gone through more than one JPEG encode pass (e.g. edited and resaved, or decoded/re-encoded by an intermediate tool or platform). This is not proof of a specific edit location or intent — many ordinary workflows (export, re-upload, format conversion) legitimately recompress a file this way without any malicious editing.",
      evidence: forensics.evidence.filter((e) => e.description.includes("separate DQT")),
    });
  }

  const qualities = forensics.estimatedQualityByTable;
  if (qualities.length >= 2) {
    const spread = Math.max(...qualities) - Math.min(...qualities);
    if (spread > 25) {
      findings.push({
        id: "jpeg-quality-table-spread",
        title: "Unusually large gap between this file's quantization tables' estimated quality",
        severity: "notable",
        confidence: "low",
        explanation: `Estimated qualities across this file's tables: ${qualities.join(", ")}. A normal single-pass encode's luma and chroma tables are both derived from the same requested quality setting and track closely together; a large gap between them is a soft signal (not a reliable one on its own — quality estimation from a table is approximate) that is worth weighing alongside the other findings here, not read in isolation.`,
        evidence: [],
      });
    }
  }

  if (forensics.progressive) {
    findings.push({
      id: "jpeg-progressive",
      title: "Progressive JPEG encoding",
      severity: "info",
      confidence: "high",
      explanation:
        "This file uses progressive (multi-scan) encoding rather than baseline. Informational only — many legitimate encoders and platforms (web image optimizers, some phone cameras) default to progressive; it is not itself a forensic signal of editing.",
      evidence: [],
    });
  }

  return findings;
}
