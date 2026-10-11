import { MAGIC_SIGNATURES, detectFileType, type FileSignature } from "./signatures";

// ---------- Embedded / hidden file detection ----------

export type EmbeddedFinding = { offset: number; label: string; dangerous: boolean; confidence: "high" | "moderate" };

// A short and/or all-distinct-byte signature WILL turn up by pure chance
// somewhere in any sufficiently large file — scanning for it at every
// offset without accounting for that is how a clean video/audio file
// ends up "containing" a Windows icon and a raw MP3 frame sync purely
// from coincidence in its compressed payload. This models that chance
// directly: the probability any single offset matches a signature of
// `sigLength` bytes is 1/256^sigLength, so across `searchSpace`
// independent offsets the expected number of PURELY RANDOM matches is
// searchSpace / 256^sigLength (Poisson approximation — accurate here
// since every signature actually in play is far more than
// log256(searchSpace) bytes long once it clears the filter below).
function expectedRandomOccurrences(searchSpace: number, sigLength: number): number {
  if (searchSpace <= 0) return 0;
  return searchSpace / Math.pow(256, sigLength);
}

// Zero bytes are not evenly distributed the way the formula above
// assumes — they cluster deliberately in ANY structured binary format's
// reserved fields, size/flag words, and alignment padding, which sit
// disproportionately near a container's own header (exactly where a
// scan like this one starts looking). A signature that's mostly zero
// bytes (TrueType's `00 01 00 00`, an ICO's `00 00 01 00`, a cursor's
// `00 00 02 00`) is far less specific than its raw combinatorial odds
// suggest, so those are excluded outright rather than trusted to the
// statistical filter alone.
function zeroByteCount(sigBytes: number[]): number {
  return sigBytes.filter((b) => b === 0).length;
}

/** Scans the WHOLE buffer (not just the header) for any OTHER known
 * file signature appearing at some later offset — a lightweight version
 * of what tools like `binwalk` do. This is how you catch a ZIP or an
 * executable concatenated onto the end of an otherwise-normal image or
 * document (a common way to smuggle a payload past someone who only
 * glances at the thumbnail/preview). Only reports matches beyond a small
 * skip window so the file's own real header at offset 0 isn't reported
 * as "embedded inside itself", and only signatures specific enough that
 * a match is genuinely surprising for a file this size — see
 * expectedRandomOccurrences()/zeroByteCount() above for why that matters
 * on compressed/media files specifically. */
export function scanEmbeddedSignatures(bytes: Uint8Array, primaryType: FileSignature | null): EmbeddedFinding[] {
  const findings: EmbeddedFinding[] = [];
  const skipUntil = 64; // past any reasonable header region
  const seen = new Set<string>();
  const searchSpace = Math.max(0, bytes.length - skipUntil);

  // Compressed/media containers legitimately have zero-heavy metadata
  // (box/atom headers, reserved fields) clustered near their start —
  // exactly where short signatures spuriously "match" — so demand more
  // statistical specificity there than in a plaintext-based format,
  // where a real hit means proportionally more.
  const strict = primaryType?.naturallyHighEntropy ?? false;
  const confidentThreshold = strict ? 0.0005 : 0.01;
  const moderateThreshold = strict ? 0.01 : 0.05;

  for (const sig of MAGIC_SIGNATURES) {
    if (primaryType && sig.label === primaryType.label) continue; // that's just the file's own type
    if (zeroByteCount(sig.bytes) >= 2) continue; // not specific enough to mean anything at an arbitrary offset
    const expected = expectedRandomOccurrences(searchSpace, sig.bytes.length);
    if (expected > moderateThreshold) continue; // this short a signature is statistically meaningless in a file this size
    const confidence: "high" | "moderate" = expected <= confidentThreshold ? "high" : "moderate";

    // Cheap search: scan for the first byte, verify the rest on match.
    const first = sig.bytes[0];
    for (let i = skipUntil; i <= bytes.length - sig.bytes.length; i++) {
      if (bytes[i] !== first) continue;
      let match = true;
      for (let j = 1; j < sig.bytes.length; j++) {
        if (bytes[i + j] !== sig.bytes[j]) { match = false; break; }
      }
      if (match) {
        const key = `${sig.label}@${i}`;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push({ offset: i, label: sig.label, dangerous: sig.dangerous, confidence });
        }
        break; // one hit per signature is enough to flag it
      }
    }
    if (findings.length >= 8) break; // cap the scan cost on very large files
  }

  // PE (Windows executable) polyglots/concatenation are common and real
  // enough — and "MZ" alone is only 2 bytes, which the generic filter
  // above will always treat as too weak to trust once a file is more
  // than a few hundred bytes — that this gets its own dedicated,
  // STRUCTURALLY verified check instead of relying on statistics: a real
  // DOS header names its own PE header's exact offset (e_lfanew, at
  // +0x3C), so confirming a genuine "PE\0\0" signature actually sits
  // there is real validation, not a coincidence-prone guess, and doesn't
  // need the same statistical hedge as a bare byte-pattern match.
  if (findings.length < 8 && !primaryType?.label.includes("PE Executable")) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = skipUntil; i <= bytes.length - 0x40; i++) {
      if (bytes[i] !== 0x4d || bytes[i + 1] !== 0x5a) continue;
      const peOffset = i + view.getUint32(i + 0x3c, true);
      if (peOffset + 4 <= bytes.length && view.getUint32(peOffset, true) === 0x00004550) {
        findings.push({ offset: i, label: "Windows PE Executable (.exe/.dll/.scr)", dangerous: true, confidence: "high" });
        break; // one verified hit is enough to flag
      }
    }
  }

  return findings.sort((a, b) => a.offset - b.offset);
}

export type TrailingDataFinding = {
  hasTrailingData: boolean;
  trailingBytes: number;
  trailingTypeGuess: string | null;
};

/** JPEG and PNG both have a well-defined end-of-file marker. Real photos
 * from a camera/phone/editor end there; extra bytes tacked on afterward
 * is a classic steganography-lite / payload-smuggling technique (most
 * image viewers ignore trailing junk and show the photo normally). */
export function checkTrailingDataAfterEof(bytes: Uint8Array, primaryType: FileSignature | null): TrailingDataFinding {
  const none: TrailingDataFinding = { hasTrailingData: false, trailingBytes: 0, trailingTypeGuess: null };
  if (!primaryType) return none;

  let eofEnd = -1;

  if (primaryType.label === "JPEG Image") {
    // Find the LAST FF D9 (End Of Image) marker.
    for (let i = bytes.length - 2; i >= 2; i--) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) { eofEnd = i + 2; break; }
    }
  } else if (primaryType.label === "PNG Image") {
    // IEND chunk: 4-byte length(=0) + "IEND" + 4-byte CRC.
    const iendMarker = [0x49, 0x45, 0x4e, 0x44]; // "IEND"
    for (let i = 0; i <= bytes.length - 8; i++) {
      if (iendMarker.every((b, j) => bytes[i + j] === b)) { eofEnd = i + 4 + 4; break; }
    }
  } else {
    return none; // only implemented for JPEG/PNG for now
  }

  if (eofEnd === -1 || eofEnd >= bytes.length) return none;
  const trailing = bytes.length - eofEnd;
  if (trailing <= 4) return none; // a few stray padding bytes isn't meaningful

  const trailingSlice = bytes.slice(eofEnd);
  const guess = detectFileType(trailingSlice);
  return { hasTrailingData: true, trailingBytes: trailing, trailingTypeGuess: guess?.label ?? null };
}
