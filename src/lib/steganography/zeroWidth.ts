import type { StegoFinding } from "./types";
import { packBitsToBytes, printableRatio, tryDecodeUtf8 } from "./shared";

// ---------------- Zero-width Unicode text steganography ----------------

const ZERO_WIDTH_CHARS: Record<string, string> = {
  "​": "ZERO WIDTH SPACE",
  "‌": "ZERO WIDTH NON-JOINER",
  "‍": "ZERO WIDTH JOINER",
  "﻿": "ZERO WIDTH NO-BREAK SPACE / BOM",
  "⁠": "WORD JOINER",
};

export function scanZeroWidthSteganography(text: string): StegoFinding[] {
  const findings: StegoFinding[] = [];
  const counts: Record<string, number> = {};
  let total = 0;
  for (const ch of text) {
    if (ZERO_WIDTH_CHARS[ch]) {
      counts[ch] = (counts[ch] ?? 0) + 1;
      total++;
    }
  }

  if (total === 0) {
    findings.push({
      id: "zw-none",
      severity: "safe",
      title: "No zero-width Unicode characters found",
      summary: "This text contains none of the invisible Unicode characters commonly used for text-based steganography.",
      explanation: "Zero-width space/joiner characters render as nothing but still exist as real characters in the text — their complete absence here rules out this specific technique.",
      recommendation: "No action needed on this check.",
    });
    return findings;
  }

  const breakdown = Object.entries(counts).map(([ch, n]) => `${ZERO_WIDTH_CHARS[ch]} ×${n}`).join(", ");
  findings.push({
    id: "zw-present",
    severity: "warning",
    title: `${total} invisible Unicode character${total === 1 ? "" : "s"} found`,
    summary: breakdown,
    explanation: "These characters are completely invisible when the text is displayed normally, which is exactly why they're used to smuggle a hidden binary payload inside otherwise-ordinary-looking text (a technique sometimes called 'Unicode steganography' or 'invisible ink').",
    recommendation: "Check the decode attempt below. Even if it doesn't produce readable output, the mere presence of these characters in text that shouldn't have any is worth treating as suspicious on its own — legitimate text essentially never contains them.",
  });

  // Common simple convention: ZWSP=0, ZWNJ=1, ignore everything else,
  // pack 8 bits -> 1 byte, decode as UTF-8. One of several schemes in
  // real-world use, tried here as the most common one.
  const bits: number[] = [];
  for (const ch of text) {
    if (ch === "​") bits.push(0);
    else if (ch === "‌") bits.push(1);
  }
  if (bits.length >= 8) {
    const bytes = packBitsToBytes(bits);
    const decoded = tryDecodeUtf8(bytes);
    if (decoded && printableRatio(bytes) > 0.85 && decoded.trim().length > 0) {
      findings.push({
        id: "zw-decoded",
        severity: "danger",
        title: "Hidden message decoded from zero-width characters",
        summary: "Decoding ZERO WIDTH SPACE=0 / ZERO WIDTH NON-JOINER=1 (the most common convention) produced readable text.",
        explanation: "This is a direct, successful decode — not a statistical inference. A coherent printable message coming out of an 8-bit packing of invisible characters is essentially conclusive.",
        recommendation: "Review the recovered text below.",
        extracted: { kind: "text", label: "Recovered text", text: decoded },
      });
    } else {
      findings.push({
        id: "zw-undecoded",
        severity: "info",
        title: "Zero-width characters present but didn't decode with the common convention",
        summary: "The ZWSP=0/ZWNJ=1 packing didn't produce readable text — a different bit-to-character mapping may be in use.",
        explanation: "Multiple zero-width steganography tools exist with different character-to-bit conventions (some use 4 characters for base-4 encoding, some include a different separator scheme).",
        recommendation: "The presence of these characters is itself the finding — flag it even without a successful decode.",
      });
    }
  }

  return findings;
}
