import { detectFileType } from "@/lib/fileAnalysis";
import type { StegoFinding } from "./types";
import { packBitsToBytes, printableRatio, tryDecodeUtf8, pairsImbalanceScore } from "./shared";
import { scanOwnContainer } from "./container";
import { buildExtractionFinding, buildTextExtractionFinding } from "./findingBuilders";

// ---------------- Raw PCM WAV audio LSB ----------------

/** Parses just enough of a WAV file (RIFF/WAVE, fmt , data chunks) to
 * find the raw PCM sample bytes — deliberately not going through
 * Web Audio's decodeAudioData, which resamples/converts and would
 * destroy the exact LSBs a stego tool wrote. Only uncompressed PCM WAV
 * is supported; compressed audio (MP3, AAC, compressed WAV) doesn't
 * have byte-exact recoverable samples the same way. */
export function findWavDataChunk(bytes: Uint8Array): { offset: number; length: number; bitsPerSample: number } | null {
  if (bytes.length < 44) return null;
  const text = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n));
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") return null;

  let offset = 12;
  let bitsPerSample = 16;
  while (offset + 8 <= bytes.length) {
    const chunkId = text(offset, 4);
    const chunkSize = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);
    if (chunkId === "fmt ") {
      bitsPerSample = bytes[offset + 8 + 14] | (bytes[offset + 8 + 15] << 8);
    }
    if (chunkId === "data") {
      return { offset: offset + 8, length: Math.min(chunkSize, bytes.length - offset - 8), bitsPerSample };
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return null;
}

export function analyzeWavLsb(bytes: Uint8Array): StegoFinding[] {
  const chunk = findWavDataChunk(bytes);
  if (!chunk) {
    return [{
      id: "wav-unparseable",
      severity: "info",
      title: "Couldn't locate PCM sample data",
      summary: "This doesn't look like an uncompressed PCM WAV file (or the RIFF structure couldn't be parsed).",
      explanation: "LSB audio steganography requires byte-exact access to uncompressed samples — compressed formats (MP3, compressed WAV) don't preserve the LSBs a stego tool would have written.",
      recommendation: "If this file was reported as MP3/compressed, LSB analysis isn't applicable — those formats use different (much harder to detect) techniques like echo hiding or phase coding.",
    }];
  }

  const sampleBytes = bytes.subarray(chunk.offset, chunk.offset + chunk.length);
  // For 16-bit PCM, the LSB of every LOW byte (every other byte, little-endian) is the meaningful one.
  const step = chunk.bitsPerSample === 16 ? 2 : 1;
  const bits: number[] = [];
  for (let i = 0; i < sampleBytes.length; i += step) bits.push(sampleBytes[i] & 1);
  const extracted = packBitsToBytes(bits);

  const findings: StegoFinding[] = [];

  const ownContainer = scanOwnContainer(extracted, "audio LSB");
  if (ownContainer.length > 0) return ownContainer;

  const score = pairsImbalanceScore(sampleBytes.filter((_, i) => i % step === 0));
  if (score < 0.1) {
    findings.push({
      id: "wav-lsb-suspicious",
      severity: "warning",
      title: "Audio sample LSBs show a statistical anomaly",
      summary: `Pairs-of-values imbalance score on the low sample bytes: ${score.toFixed(3)}.`,
      explanation: "The same pairs-analysis logic used for image LSB steganography applied to the low byte of each 16-bit PCM sample — a low score here is the audio equivalent of the same tampering signature.",
      recommendation: "Check the extraction attempt below for a recoverable file or text.",
    });
  }

  const asFile = detectFileType(extracted);
  if (asFile) {
    findings.push(buildExtractionFinding("wav-lsb-file", asFile, extracted));
  } else {
    const text = tryDecodeUtf8(extracted.subarray(0, Math.min(extracted.length, 20_000)));
    if (text) {
      const nullIdx = text.indexOf(" ");
      const candidate = nullIdx > 8 ? text.slice(0, nullIdx) : text.slice(0, 2000);
      if (candidate.trim().length >= 8 && printableRatio(new TextEncoder().encode(candidate)) > 0.9) {
        findings.push(buildTextExtractionFinding("wav-lsb-text", candidate, "the raw audio-sample LSB bitstream"));
      }
    }
  }

  if (!findings.some((f) => f.extracted) && score >= 0.1) {
    findings.push({
      id: "wav-lsb-clean",
      severity: "safe",
      title: "No LSB steganography pattern found in audio samples",
      summary: `Pairs-of-values imbalance score: ${score.toFixed(3)}, no valid payload extracted.`,
      explanation: "Consistent with unmodified PCM audio.",
      recommendation: "No action needed on this check.",
    });
  }

  return findings;
}
