import { detectFileType } from "@/lib/fileAnalysis";
import { extractPrintableStrings, findBase64Candidates } from "@/lib/stringExtraction";
import type { StegoFinding } from "./types";

// ---------------- Generic strings/base64 deep scan (any file, any tool) ----------------
//
// The single most tool-agnostic technique available: extract every
// printable-text run from the raw bytes (the same job the Unix
// `strings` utility does) regardless of file type or what — if
// anything — hid content inside it, then attempt to decode any long
// base64-looking run found. This is what actually answers "extract
// whatever is hidden, no matter who put it there," since it makes no
// assumption about the embedding technique at all.

export function deepScanStrings(bytes: Uint8Array): StegoFinding[] {
  const findings: StegoFinding[] = [];
  const strings = extractPrintableStrings(bytes, 6, 2000);
  const meaningful = strings.filter((s) => s.text.trim().length >= 6);

  if (meaningful.length > 0) {
    const preview = meaningful.slice(0, 400).map((s) => `[${s.encoding} @${s.offset}] ${s.text}`).join("\n");
    findings.push({
      id: "deep-strings",
      severity: "info",
      title: `${meaningful.length.toLocaleString()} readable text string${meaningful.length === 1 ? "" : "s"} found in the raw file bytes`,
      summary: "Extracted directly from the file's bytes regardless of file type or embedding method — the same first move a real analyst makes with the `strings` utility, before assuming anything about how (or whether) something was hidden.",
      explanation: "Most of these are ordinary structural text any file of this type naturally contains — but this is exactly where an appended note, a hidden password, or a plain-text message dropped anywhere in the file (not just in a pixel/sample plane) would show up.",
      recommendation: "Scan the extracted strings below for anything that looks out of place — actual sentences, credentials, URLs, or unusually long strings that don't belong in this file type.",
      extracted: { kind: "text", label: "Extracted strings", text: preview },
    });
  }

  const allText = meaningful.map((s) => s.text).join("\n");
  const base64Hits = findBase64Candidates(allText);
  for (const hit of base64Hits) {
    if (hit.decodedText) {
      findings.push({
        id: `deep-b64-${hit.raw.slice(0, 16)}`,
        severity: "danger",
        title: "Base64-encoded text found and decoded",
        summary: `A ${hit.raw.length}-character base64-looking string decoded to readable text.`,
        explanation: "A long base64 run decoding cleanly into coherent, high-printable-ratio text is strong evidence it was deliberately placed there — random binary data does not decode into readable language by chance.",
        recommendation: "Review the decoded text below.",
        extracted: { kind: "text", label: "Decoded base64", text: hit.decodedText },
      });
    } else if (hit.decodedBytes) {
      const asFile = detectFileType(hit.decodedBytes);
      // Require a reasonably specific signature match (4+ magic bytes)
      // before reporting this as a finding. Short 2-3 byte signatures
      // (BMP, ICO/CUR) are already a known, disclosed false-positive
      // source when scanning raw bytes directly — this base64 path
      // makes that worse by checking dozens of candidate windows per
      // file instead of one, so it needs a stricter bar specifically
      // here to stay trustworthy on compressed/audio/video covers
      // (whose byte content isn't uniformly random and can coincidentally
      // contain a base64-alphabet run purely by chance).
      if (asFile && asFile.bytes.length >= 4) {
        findings.push({
          id: `deep-b64-file-${hit.raw.slice(0, 16)}`,
          severity: "warning",
          title: `Possible base64-encoded file found and decoded: ${asFile.label}`,
          summary: `A ${hit.raw.length}-character base64-looking string decoded to something matching the ${asFile.label} signature.`,
          explanation: "A base64 blob decoding into a real file signature is a real, meaningful signal — but on a compressed/binary cover (audio, video, archives), this can occasionally be a coincidental match rather than a deliberately hidden file, since the cover's own compressed data isn't uniformly random and can by chance contain a run of bytes that happens to look like base64.",
          recommendation: "Download and try opening the file as the type named above. If it opens correctly, this is real; if it's garbled/corrupt, this was a coincidental false match — safe to disregard.",
          extracted: { kind: "binary", label: `${asFile.label} (decoded from base64)`, bytes: hit.decodedBytes, mime: asFile.mime },
        });
      }
    }
  }

  if (findings.length === 0) {
    findings.push({
      id: "deep-none",
      severity: "safe",
      title: "No readable strings or base64 blobs found",
      summary: "The generic, format-agnostic string/base64 scan found nothing worth surfacing.",
      explanation: "This check makes no assumption about file type or embedding method — a clean result here is meaningful precisely because it doesn't depend on knowing what to look for.",
      recommendation: "Combine with the format-specific checks above for a complete picture.",
    });
  }

  return findings;
}
