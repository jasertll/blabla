import type { FileSignature } from "@/lib/fileAnalysis";
import type { StegoFinding } from "./types";

// Shared finding constructors for a successful LSB extraction (image or
// audio, default convention or brute-forced) — used by lsb.ts and
// audioLsb.ts so both report a matching file/text recovery the same way.

export function buildExtractionFinding(id: string, sig: FileSignature, bytes: Uint8Array): StegoFinding {
  return {
    id,
    severity: "danger",
    title: `Hidden file recovered: ${sig.label}`,
    summary: `LSB extraction produced ${bytes.length.toLocaleString()} bytes that are a valid ${sig.label}.`,
    explanation: "A successful file-signature match on extracted LSB data is strong, near-conclusive evidence of deliberate steganographic embedding — this isn't a statistical guess, the extracted bytes decode as a real, well-formed file.",
    recommendation: "Save and inspect the extracted file in an isolated environment — treat it as untrusted content, especially if it's itself an executable, script, or archive.",
    extracted: { kind: "binary", label: `${sig.label} (extracted via LSB)`, bytes, mime: sig.mime },
    evidence: [{ sourceEngine: "lsb-extractor", description: `${bytes.length.toLocaleString()} extracted bytes match ${sig.label}'s real magic-byte signature`, confidence: "high" }],
  };
}

export function buildTextExtractionFinding(id: string, text: string, method: string): StegoFinding {
  return {
    id,
    severity: "danger",
    title: "Hidden text recovered",
    summary: `LSB extraction (${method}) produced a readable text message.`,
    explanation: "Recovering coherent, high-ratio-printable text from the image's least-significant bits is strong evidence of deliberate text steganography — random noise does not decode into readable language.",
    recommendation: "Review the recovered text below. Treat it as evidence in its own right — hidden text is sometimes a message, sometimes credentials, sometimes an encoded command.",
    extracted: { kind: "text", label: "Recovered text", text },
    evidence: [{ sourceEngine: "lsb-extractor", description: `${method} decoded ${text.length.toLocaleString()} chars of high-printable-ratio text`, confidence: "high" }],
  };
}
