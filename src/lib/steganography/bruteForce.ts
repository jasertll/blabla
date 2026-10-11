import { detectFileType } from "@/lib/fileAnalysis";
import type { StegoFinding } from "./types";
import { printableRatio, tryDecodeUtf8 } from "./shared";
import { scanOwnContainer } from "./container";

// ---------------- Multi-strategy LSB brute force (tool-agnostic) ----------------
//
// analyzeImageLsb() (lsb.ts) tries exactly one convention: bit 0 of
// R,G,B, row-major, MSB-first bit packing — the most common one, but
// only one of many a third-party tool could have used. This tries the
// other well-documented conventions real steganalysis tools (zsteg is
// the standard open-source example) brute-force: which channels are used
// and in what order, which bit plane, and which bit-packing order —
// so recovery doesn't depend on knowing which tool hid the data.

const CHANNEL_COMBOS: { label: string; channels: number[] }[] = [
  { label: "RGBA", channels: [0, 1, 2, 3] },
  { label: "BGR", channels: [2, 1, 0] },
  { label: "R only", channels: [0] },
  { label: "G only", channels: [1] },
  { label: "B only", channels: [2] },
  { label: "A only", channels: [3] },
];

function packBitPlane(imageData: ImageData, channels: number[], bitPlane: number, msbFirst: boolean): Uint8Array {
  const { data, width, height } = imageData;
  const pixelCount = width * height;
  const totalBits = pixelCount * channels.length;
  const byteCount = Math.floor(totalBits / 8);
  const out = new Uint8Array(byteCount);
  let curByte = 0;
  let bitPos = 0;
  let outIdx = 0;
  outer: for (let p = 0; p < pixelCount; p++) {
    const base = p * 4;
    for (const ch of channels) {
      const val = (data[base + ch] >> bitPlane) & 1;
      curByte = msbFirst ? (curByte << 1) | val : curByte | (val << bitPos);
      bitPos++;
      if (bitPos === 8) {
        out[outIdx++] = curByte;
        curByte = 0;
        bitPos = 0;
        if (outIdx >= byteCount) break outer;
      }
    }
  }
  return out;
}

function tryExtractFromBytes(extracted: Uint8Array, label: string, idSuffix: string): StegoFinding | null {
  const asFile = detectFileType(extracted);
  if (asFile) {
    return {
      id: `brute-file-${idSuffix}`,
      severity: "danger",
      title: `Hidden file recovered via a non-default LSB convention: ${asFile.label}`,
      summary: `Trying "${label}" (a convention other than this scanner's default bit0/RGB) produced ${extracted.length.toLocaleString()} bytes matching a valid ${asFile.label} signature.`,
      explanation: "This confirms LSB steganography using a different channel/bit-plane/order convention than the default — a successful file-signature match here is just as conclusive as the primary strategy's, it just needed a different extraction convention to reveal it.",
      recommendation: "Save and inspect the extracted file in an isolated environment.",
      extracted: { kind: "binary", label: `${asFile.label} (LSB, ${label})`, bytes: extracted, mime: asFile.mime },
    };
  }
  if (extracted.length > 4) {
    const declaredLen = (extracted[0] << 24) | (extracted[1] << 16) | (extracted[2] << 8) | extracted[3];
    if (declaredLen > 8 && declaredLen <= extracted.length - 4 && declaredLen < 20_000_000) {
      const payload = extracted.subarray(4, 4 + declaredLen);
      const asFileH = detectFileType(payload);
      if (asFileH) {
        return {
          id: `brute-header-file-${idSuffix}`,
          severity: "danger",
          title: `Hidden file recovered (length-prefixed, ${label}): ${asFileH.label}`,
          summary: `A 32-bit length header under the "${label}" convention pointed at a valid ${asFileH.label}.`,
          explanation: "Length-prefixed LSB extraction succeeding under a non-default channel/bit convention is strong, direct evidence — not a guess.",
          recommendation: "Save and inspect the extracted file in an isolated environment.",
          extracted: { kind: "binary", label: `${asFileH.label} (LSB, ${label})`, bytes: payload, mime: asFileH.mime },
        };
      }
      const text = tryDecodeUtf8(payload.subarray(0, Math.min(payload.length, 20_000)));
      if (text && printableRatio(payload) > 0.9 && text.trim().length >= 8) {
        return {
          id: `brute-header-text-${idSuffix}`,
          severity: "danger",
          title: `Hidden text recovered (length-prefixed, ${label})`,
          summary: `A 32-bit length header under the "${label}" convention decoded to readable text.`,
          explanation: "Length-prefixed LSB extraction succeeding under a non-default channel/bit convention is strong, direct evidence — not a guess.",
          recommendation: "Review the recovered text below.",
          extracted: { kind: "text", label: "Recovered text", text },
        };
      }
    }
  }
  const rawText = tryDecodeUtf8(extracted.subarray(0, Math.min(extracted.length, 20_000)));
  if (rawText) {
    const spaceIdx = rawText.indexOf(" ");
    const candidate = spaceIdx > 8 ? rawText.slice(0, spaceIdx) : rawText.slice(0, 2000);
    if (candidate.trim().length >= 10 && printableRatio(new TextEncoder().encode(candidate)) > 0.92) {
      return {
        id: `brute-raw-text-${idSuffix}`,
        severity: "danger",
        title: `Hidden text recovered (raw LSB, ${label})`,
        summary: `Raw LSB extraction under the "${label}" convention (no header assumed) produced readable text.`,
        explanation: "Recovering coherent text from a non-default LSB convention is direct evidence of deliberate embedding using that specific convention.",
        recommendation: "Review the recovered text below.",
        extracted: { kind: "text", label: "Recovered text", text: candidate },
      };
    }
  }
  return null;
}

/** Brute-forces the OTHER common LSB conventions (channel selection,
 * bit plane, and bit-packing order) beyond analyzeImageLsb()'s default
 * — for recovering content hidden by a third-party tool that made a
 * different convention choice. Bounded to keep it fast in-browser: only
 * runs on images under a size cap, and reports which conventions were
 * tried even when none produced a result, so the absence of a hit is
 * informative rather than silent. */
export function bruteForceLsbScan(imageData: ImageData): StegoFinding[] {
  const pixelCount = imageData.width * imageData.height;
  if (pixelCount > 4_000_000) {
    return [{
      id: "brute-skipped",
      severity: "info",
      title: "Multi-convention brute force skipped (image too large)",
      summary: `${imageData.width}×${imageData.height} exceeds the size this scanner brute-forces in-browser.`,
      explanation: "Trying every channel/bit-plane/order combination on a very large image would be slow in a browser tab — only the default bit0/RGB convention (checked above) was tried.",
      recommendation: "For a full multi-convention sweep on a large image, a dedicated desktop tool like zsteg or StegSolve would be faster.",
    }];
  }

  const triedLabels: string[] = [];
  const findings: StegoFinding[] = [];
  for (const combo of CHANNEL_COMBOS) {
    for (const bitPlane of [0, 1]) {
      for (const msbFirst of [true, false]) {
        const label = `${combo.label}, bit ${bitPlane}, ${msbFirst ? "MSB" : "LSB"}-first`;
        triedLabels.push(label);
        const extracted = packBitPlane(imageData, combo.channels, bitPlane, msbFirst);
        const idSuffix = `${combo.label}-${bitPlane}-${msbFirst ? "m" : "l"}`.replace(/\s+/g, "");

        const ownContainer = scanOwnContainer(extracted, `image LSB (${label})`);
        if (ownContainer.length > 0) { findings.push(...ownContainer); continue; }

        const hit = tryExtractFromBytes(extracted, label, idSuffix);
        if (hit) findings.push(hit);
      }
    }
  }

  if (findings.length === 0) {
    findings.push({
      id: "brute-none",
      severity: "info",
      title: `No payload recovered across ${triedLabels.length} additional LSB conventions tried`,
      summary: `Tried: ${triedLabels.join(" · ")}.`,
      explanation: "Combined with the default bit0/RGB/MSB-first strategy checked above, this covers the channel-selection, bit-plane, and bit-order conventions that account for the large majority of real-world simple LSB steganography tools.",
      recommendation: "If nothing was found here or above, and you still suspect this image, the data may be hidden with a password-seeded pixel path, in the DCT domain (JPEG-specific), or isn't LSB steganography at all — check the Embedded/Trailing Data and generic string/base64 scan sections instead.",
    });
  }

  return findings;
}
