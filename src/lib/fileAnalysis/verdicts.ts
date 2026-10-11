import type { FileSignature } from "./signatures";
import type { ExtensionCheck } from "./extensionCheck";
import type { EmbeddedFinding, TrailingDataFinding } from "./embedded";
import type { EntropyProfile } from "./entropy";
import type { EvidenceItem } from "../evidenceModel";

// ---------- Unified verdicts ----------

export type Severity = "danger" | "warning" | "info" | "safe";

// Re-exported for existing importers (@/lib/fileAnalysis's `EvidenceItem`
// export) — the canonical definition now lives in lib/evidenceModel.ts so
// other tools (Steganography, PCAP, ...) share the exact same shape
// instead of each declaring their own local lookalike.
export type { EvidenceItem };

export type Verdict = {
  id: string;
  title: string;
  severity: Severity;
  summary: string;
  explanation: string;
  recommendation: string;
  // Optional so every existing construction site (macro/PE/ELF/indicator
  // findings mapped to Verdict shape elsewhere) keeps compiling unchanged
  // — populated here for the checks built directly in buildVerdicts().
  evidence?: EvidenceItem[];
};

const SEVERITY_RANK: Record<Severity, number> = { danger: 3, warning: 2, info: 1, safe: 0 };

export function worstSeverity(verdicts: Verdict[]): Severity {
  return verdicts.reduce<Severity>((worst, v) => (SEVERITY_RANK[v.severity] > SEVERITY_RANK[worst] ? v.severity : worst), "safe");
}

// Real-world static analysis tools (VirusTotal's "N/70 engines flagged
// this", capa's namespaced capability list with no single verdict,
// AV heuristic engines' weighted-scoring detections) avoid collapsing
// straight to "malicious" off one weak-to-moderate signal, specifically
// because individually-common patterns (an .exe being an .exe, a small
// import table, a single capability match) have too many legitimate
// explanations on their own. A weighted score that needs either one
// genuinely strong correlated finding OR several weaker ones together
// to cross into "danger" mirrors that practice far better than "the
// single worst finding decides the whole verdict."
const SEVERITY_WEIGHT: Record<Severity, number> = { danger: 3, warning: 1, info: 0, safe: 0 };
const DANGER_THRESHOLD = 5; // needs 2 danger findings, or 1 danger + 2 warnings, etc.
const WARNING_THRESHOLD = 2; // needs 1 danger alone, or 2+ warnings together

export function computeRiskScore(verdicts: Verdict[]): { score: number; tier: Severity } {
  const score = verdicts.reduce((sum, v) => sum + SEVERITY_WEIGHT[v.severity], 0);
  const tier: Severity = score >= DANGER_THRESHOLD ? "danger" : score >= WARNING_THRESHOLD ? "warning" : "safe";
  return { score, tier };
}

/** Synthesizes every individual check into one consistent list of
 * verdicts — each with a severity, a plain-language explanation of WHY
 * it matters, and a concrete recommendation, instead of scattered raw
 * numbers the user has to interpret themselves. */
export function buildVerdicts(input: {
  primaryType: FileSignature | null;
  extensionCheck: ExtensionCheck;
  embedded: EmbeddedFinding[];
  trailing: TrailingDataFinding;
  entropyProfile: EntropyProfile;
  hasMacros: boolean | null;
  macroNote: string;
  suspiciousStringCount: number;
  circlStatus: "ok" | "not_found" | "error" | null;
}): Verdict[] {
  const verdicts: Verdict[] = [];

  if (input.extensionCheck.mismatch) {
    verdicts.push({
      id: "extension-mismatch",
      title: "File extension does not match its real content",
      severity: "danger",
      summary: input.extensionCheck.note,
      explanation:
        "Malware is very commonly disguised by giving it a filename that ends in a trusted extension (like .pdf or .jpg) while the actual file content is something else entirely, often an executable or script.",
      recommendation:
        "Do not open this file with whatever application the extension suggests. If you need to confirm what it is, inspect it in an isolated environment first.",
      evidence: [
        { sourceEngine: "magic-byte-signature-scanner", description: input.extensionCheck.note, offset: 0, confidence: "high" },
      ],
    });
  } else if (input.primaryType) {
    verdicts.push({
      id: "extension-ok",
      title: "File extension matches its real content",
      severity: "safe",
      summary: input.extensionCheck.note,
      explanation: "The file's magic-byte signature is consistent with what its name claims.",
      recommendation: "No action needed on this specific check.",
    });
  }

  if (input.primaryType?.dangerous) {
    verdicts.push({
      id: "dangerous-type",
      title: `This is a ${input.primaryType.label}`,
      severity: "warning",
      summary: "Executable/script-capable file types carry inherent risk regardless of how they arrived.",
      explanation:
        "Files of this type can run code directly on whatever machine opens them, unlike passive documents, images, or media.",
      recommendation:
        "Only run this if you fully trust its source, ideally after scanning it with dedicated antivirus/EDR tooling — static triage here can't tell you what it does when executed.",
    });
  }

  if (input.embedded.length > 0) {
    // Only a HIGH-confidence match on a signature the scan already
    // knows is dangerous (see scanEmbeddedSignatures — both the
    // statistical and zero-byte filters have already run by this point)
    // earns "danger"; anything resting on a merely "moderate" match is
    // downgraded, since that confidence band means the match could still
    // plausibly be coincidental in a large/compressed file even after
    // filtering, not a real embedded file.
    const dangerousHighConfidence = input.embedded.filter((e) => e.dangerous && e.confidence === "high");
    const anyModerate = input.embedded.some((e) => e.confidence === "moderate");
    verdicts.push({
      id: "embedded-signatures",
      title: `${input.embedded.length} additional file signature${input.embedded.length === 1 ? "" : "s"} found inside this file`,
      severity: dangerousHighConfidence.length > 0 ? "danger" : "warning",
      summary: input.embedded.map((e) => `${e.label} at byte offset ${e.offset}${e.confidence === "moderate" ? " (lower confidence)" : ""}`).join("; "),
      explanation:
        "A well-formed file of this type shouldn't contain other file signatures buried in its body. This can mean another file is concatenated or hidden inside it — a real technique used to smuggle a payload past a quick look or a naive scanner." +
        (anyModerate
          ? " At least one match here is only \"moderate\" confidence — its signature is short/common enough that, even after filtering out statistically-meaningless matches, it could still occasionally be coincidental in a large or already-compressed file rather than a genuine embedded file."
          : ""),
      recommendation:
        dangerousHighConfidence.length > 0
          ? "Treat this file as actively suspicious. Don't open it normally — extract and inspect the embedded content in an isolated environment."
          : "Worth a closer look with a dedicated carving tool (e.g. binwalk) before fully trusting this file.",
      evidence: input.embedded.map((e) => ({
        sourceEngine: "embedded-signature-scanner",
        description: `${e.label} signature match`,
        offset: e.offset,
        confidence: e.confidence,
      })),
    });
  }

  if (input.trailing.hasTrailingData) {
    verdicts.push({
      id: "trailing-data",
      title: "Extra data found after the file's normal end marker",
      severity: input.trailing.trailingTypeGuess ? "danger" : "warning",
      summary: `${input.trailing.trailingBytes} bytes follow the expected end of the ${input.primaryType?.label ?? "file"}${
        input.trailing.trailingTypeGuess ? `, identified as ${input.trailing.trailingTypeGuess}` : ""
      }.`,
      explanation:
        "Most image viewers stop reading at the format's official end marker and silently ignore anything appended after it — which is exactly what makes this a common way to hide a second file (an archive, a script, another image) inside what looks like an ordinary photo.",
      recommendation: "Extract the bytes after the end marker and inspect them separately before trusting this file.",
      evidence: [
        {
          sourceEngine: "trailing-data-scanner",
          description: input.trailing.trailingTypeGuess
            ? `${input.trailing.trailingBytes} bytes after the format's end marker, matching a ${input.trailing.trailingTypeGuess} signature`
            : `${input.trailing.trailingBytes} bytes after the format's end marker (type not identified)`,
          confidence: input.trailing.trailingTypeGuess ? "high" : "moderate",
        },
      ],
    });
  }

  {
    const { entropyProfile } = input;
    const naturallyHigh = input.primaryType?.naturallyHighEntropy ?? false;
    const totalBlocks = entropyProfile.blocks.length;
    const run = entropyProfile.highEntropyRun;
    const runCoversWholeFile = run !== null && totalBlocks > 0 && run.length / totalBlocks >= 0.9;

    // Localized spike: a contiguous high-entropy region sitting inside an
    // otherwise lower-entropy file is a sharper signal than one aggregate
    // number — it points at exactly where a packed/encrypted payload (or
    // a steganographic insert) sits, rather than describing the whole
    // file as vaguely "random-ish".
    if (run && !runCoversWholeFile && run.length >= 3) {
      const sizeBytes = run.endByte - run.startByte;
      verdicts.push({
        id: "entropy-localized",
        title: "Localized high-entropy segment found inside the file",
        severity: naturallyHigh ? "warning" : "danger",
        summary: `Bytes ${run.startByte.toLocaleString()}–${run.endByte.toLocaleString()} (~${(sizeBytes / 1024).toFixed(1)} KB) are near-random, while the rest of the file isn't.`,
        explanation: naturallyHigh
          ? "Even in a compressed container, one region standing out from the rest can mean a separately-encrypted or separately-compressed object was inserted after the fact — worth a look, though far less unusual here than in a plaintext-based format."
          : "A contiguous block of near-random bytes sitting inside an otherwise structured/low-entropy file is a classic fingerprint of an embedded encrypted payload, a packed second-stage, or steganographically-hidden data — much more specific than a single whole-file entropy number, because it tells you WHERE to look, not just that something might be off.",
        recommendation: `Extract and inspect bytes ${run.startByte.toLocaleString()}–${run.endByte.toLocaleString()} on their own — check them against the magic-byte table (they may be an embedded file) or run this file through the Steganography Scanner and a hex viewer.`,
        evidence: [
          {
            sourceEngine: "entropy-analyzer",
            description: `Contiguous high-entropy run spanning ${run.length} of ${totalBlocks} blocks`,
            offset: run.startByte,
            confidence: naturallyHigh ? "moderate" : "high",
          },
        ],
      });
    }

    if (entropyProfile.overall > 7.2) {
      if (naturallyHigh) {
        verdicts.push({
          id: "entropy-expected",
          title: "High entropy — expected for this file type",
          severity: "safe",
          summary: `${entropyProfile.overall.toFixed(2)} / 8 bits per byte, consistent with ${input.primaryType!.label}'s built-in compression.`,
          explanation:
            "This format is compressed or encoded by design (JPEG/PNG pixel data, ZIP/OOXML deflate streams, MP4/MP3 codecs…) — a near-random byte distribution across the whole file is the normal, healthy baseline here, not a sign of anything hidden. Treating every compressed file as suspicious purely because of its entropy number is a common false-positive trap — high entropy is not conclusive proof of anything on its own, and for this file type it's actively expected.",
          recommendation: "No action needed from entropy alone. The localized-spike and embedded-signature checks above are what would actually catch something hidden inside a file like this.",
          evidence: [
            { sourceEngine: "entropy-analyzer", description: `Whole-file entropy ${entropyProfile.overall.toFixed(2)}/8`, confidence: "high" },
          ],
        });
      } else {
        verdicts.push({
          id: "entropy-elevated",
          title: "High entropy across the whole file",
          severity: "warning",
          summary: `${entropyProfile.overall.toFixed(2)} / 8 bits per byte — this file type is not normally compressed or encrypted, so a near-random distribution across its entirety is worth explaining.`,
          explanation:
            "For a format that's normally plaintext-based or only lightly encoded (documents, scripts, unpacked executables, uncompressed media), uniformly high entropy across the WHOLE file is consistent with packing (a common technique to evade static signature scanning) or full-file encryption. This is still not proof by itself: legitimate software is packed too (UPX and similar compressors are used far outside malware), and a small or unusually structured file can occasionally read as high-entropy by chance alone.",
          recommendation: "Treat this as a supporting signal, not a verdict on its own. It matters far more when combined with an extension mismatch, a dangerous file type, or the embedded/trailing-data findings above than in isolation.",
          evidence: [
            { sourceEngine: "entropy-analyzer", description: `Whole-file entropy ${entropyProfile.overall.toFixed(2)}/8, elevated for this file type`, confidence: "moderate" },
          ],
        });
      }
    } else if (naturallyHigh && entropyProfile.overall < 5.5) {
      verdicts.push({
        id: "entropy-low-for-type",
        title: "Lower entropy than expected for this file type",
        severity: "info",
        summary: `${entropyProfile.overall.toFixed(2)} / 8 bits per byte is low for a ${input.primaryType!.label}, which is normally compressed.`,
        explanation:
          "Not a security concern by itself — usually just means the underlying content is simple or repetitive (a mostly solid-color image, silence in an audio track, a near-empty archive), so the compressor had little redundancy to remove.",
        recommendation: "No action needed — informational only.",
      });
    }
  }

  if (input.hasMacros === true) {
    verdicts.push({
      id: "macros",
      title: "Contains macros",
      severity: "danger",
      summary: input.macroNote,
      explanation:
        "VBA macros run automatically (via AutoOpen/Document_Open) when the document is opened with macros enabled, and are one of the most common real-world malware delivery mechanisms in office documents.",
      recommendation:
        "Do not enable macros/content when opening this file unless you wrote it yourself or fully trust its source. Open it in Protected View or a sandboxed viewer if you need to inspect it.",
      evidence: [{ sourceEngine: "macro-analyzer", description: input.macroNote, confidence: "high" }],
    });
  } else if (input.hasMacros === null && input.macroNote.includes("Legacy")) {
    verdicts.push({
      id: "macros-unknown",
      title: "Macro status could not be determined",
      severity: "warning",
      summary: input.macroNote,
      explanation:
        "Legacy .doc/.xls/.ppt binary formats need a full OLE2/CFB parser to reliably detect embedded macros, which isn't implemented here.",
      recommendation: "Treat this file as macro-capable until proven otherwise — don't enable content/macros when opening it.",
    });
  }

  if (input.suspiciousStringCount > 0) {
    verdicts.push({
      id: "suspicious-strings",
      title: `${input.suspiciousStringCount} suspicious string${input.suspiciousStringCount === 1 ? "" : "s"} found`,
      severity: input.suspiciousStringCount >= 4 ? "danger" : "warning",
      summary: "Command/scripting keywords and living-off-the-land binary names were found in the file's readable text.",
      explanation:
        "These specific strings show up constantly in real malware (PowerShell/WSH launchers, download-and-execute commands, process-injection API names) — though some also appear in entirely legitimate software, so this is a lead to investigate, not a verdict by itself.",
      recommendation: "Review the flagged strings below in context before deciding.",
      evidence: [
        {
          sourceEngine: "malware-indicator-string-matcher",
          description: `${input.suspiciousStringCount} curated command/LOLBAS string${input.suspiciousStringCount === 1 ? "" : "s"} matched in extracted text`,
          confidence: input.suspiciousStringCount >= 4 ? "high" : "moderate",
        },
      ],
    });
  }

  if (input.circlStatus === "ok") {
    verdicts.push({
      id: "circl-known-good",
      title: "Matches a known-good system/software file",
      severity: "safe",
      summary: "This exact SHA-256 hash is on file in CIRCL's known-good allowlist (NSRL and similar).",
      explanation: "The allowlist covers common OS and software files, so an exact match is a genuinely strong positive signal.",
      recommendation: "No action needed on this specific check.",
      evidence: [{ sourceEngine: "circl-hashlookup-api", description: "Exact SHA-256 match against CIRCL's public hashlookup service", confidence: "high" }],
    });
  }

  return verdicts;
}
