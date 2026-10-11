import { scanEmbeddedSignatures, checkTrailingDataAfterEof, type FileSignature } from "@/lib/fileAnalysis";
import type { StegoFinding } from "./types";
import { scanOwnContainer } from "./container";

// ---------------- File-in-file extraction ----------------

/** lib/fileAnalysis.ts already DETECTS an embedded/appended file (a
 * second magic signature buried mid-file, or bytes after the format's
 * own end marker) as part of the File Inspector's static-analysis
 * checks. This reuses that same detection and adds the missing piece:
 * actually slicing out and returning the bytes so they can be
 * downloaded/inspected on their own, instead of only reporting that
 * something is there. */
export function extractFileInFile(bytes: Uint8Array, primaryType: FileSignature | null): StegoFinding[] {
  const findings: StegoFinding[] = [];

  // This tool's own append-based hide method works on any cover file
  // type (including video/audio, which have no generic "real end"
  // marker to append after) — check for it first since it's an exact,
  // guaranteed recovery rather than a heuristic guess.
  const ownContainer = scanOwnContainer(bytes, "appended container");
  if (ownContainer.length > 0) return ownContainer;

  const embedded = scanEmbeddedSignatures(bytes, primaryType);
  for (const e of embedded) {
    const slice = bytes.subarray(e.offset);
    findings.push({
      id: `embedded-${e.offset}`,
      severity: e.dangerous ? "danger" : "warning",
      title: `Embedded ${e.label} extracted from offset ${e.offset.toLocaleString()}`,
      summary: `${(slice.length / 1024).toFixed(1)} KB of data starting at byte ${e.offset.toLocaleString()} matches the ${e.label} signature.`,
      explanation: "A second file signature appearing mid-file is not something a well-formed file of this type produces on its own — this is real evidence of a concatenated or embedded second file, extracted here so it can be examined directly.",
      recommendation: "Save and inspect the extracted bytes in an isolated environment. This slice runs to the end of the original file, which may include extra trailing bytes belonging to whatever comes after it — trim as needed once you know its real length.",
      extracted: { kind: "binary", label: `${e.label} (embedded, offset ${e.offset})`, bytes: slice, mime: "application/octet-stream" },
    });
  }

  const trailing = checkTrailingDataAfterEof(bytes, primaryType);
  if (trailing.hasTrailingData) {
    const startOffset = bytes.length - trailing.trailingBytes;
    const slice = bytes.subarray(startOffset);
    findings.push({
      id: `trailing-${startOffset}`,
      severity: trailing.trailingTypeGuess ? "danger" : "warning",
      title: `Trailing data extracted (${trailing.trailingBytes.toLocaleString()} bytes after the file's real end)`,
      summary: trailing.trailingTypeGuess
        ? `The ${trailing.trailingBytes.toLocaleString()} bytes appended after ${primaryType?.label ?? "the file"}'s end marker are identified as ${trailing.trailingTypeGuess}.`
        : `${trailing.trailingBytes.toLocaleString()} bytes of unidentified data follow ${primaryType?.label ?? "the file"}'s official end marker.`,
      explanation: "Most viewers/players stop reading at the format's defined end marker (JPEG's final FFD9, PNG's IEND chunk) and silently ignore anything appended after it — a standard way to hide a second file inside what looks like an ordinary photo or document.",
      recommendation: "Inspect the extracted trailing bytes below — if they match another known file type, treat that as a real embedded file, not incidental padding.",
      extracted: { kind: "binary", label: `Trailing data (${trailing.trailingTypeGuess ?? "unidentified"})`, bytes: slice, mime: "application/octet-stream" },
    });
  }

  return findings;
}
