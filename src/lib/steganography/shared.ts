// Small byte-level utilities used across multiple steganography-detection
// strategies (image LSB, audio LSB, zero-width text, brute-force) — kept
// here rather than duplicated in each module.

export function packBitsToBytes(bits: number[]): Uint8Array {
  const byteCount = Math.floor(bits.length / 8);
  const out = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
    out[i] = b;
  }
  return out;
}

export function printableRatio(bytes: Uint8Array, limit = 2000): number {
  const slice = bytes.subarray(0, Math.min(bytes.length, limit));
  if (slice.length === 0) return 0;
  let printable = 0;
  for (const b of slice) {
    if ((b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d) printable++;
  }
  return printable / slice.length;
}

export function tryDecodeUtf8(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text;
  } catch {
    return null;
  }
}

/** Pairs-of-Values analysis (Fridrich/Westfeld-style chi-square idea,
 * simplified): naive LSB replacement makes each pair of adjacent pixel
 * values (2k, 2k+1) roughly equally frequent, because the bit written
 * into the LSB no longer depends on the original value. Natural, un-
 * touched images are NOT usually this balanced. A low imbalance score
 * is evidence of LSB tampering — evidence, not proof: some naturally
 * smooth/noisy images can score low too, and this only catches the
 * "naive sequential LSB" family of tools, not more advanced schemes.
 * Also reused as-is for audio LSB (applied to the low byte of each PCM
 * sample instead of a pixel channel) — the same statistical logic. */
export function pairsImbalanceScore(channelBytes: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of channelBytes) hist[v]++;
  let totalImbalance = 0;
  let pairsCounted = 0;
  for (let i = 0; i < 128; i++) {
    const a = hist[2 * i];
    const b = hist[2 * i + 1];
    const sum = a + b;
    if (sum < 30) continue; // too few samples for this pair to be meaningful
    totalImbalance += Math.abs(a - b) / sum;
    pairsCounted++;
  }
  return pairsCounted > 0 ? totalImbalance / pairsCounted : 1;
}

/** Real bug found via round-trip testing (hide then re-scan the exact
 * output): for a cover image with genuine alpha transparency, the two
 * separate canvas draw/getImageData round-trips (once embedding, once
 * later extracting from the re-loaded PNG) can silently perturb RGB
 * values by ±1 on semi-transparent pixels — a well-documented browser
 * behavior around premultiplied-alpha compositing, even though the
 * Canvas spec calls for unpremultiplied getImageData. The statistical
 * detectors (pairs-analysis, RS-analysis) still correctly flag that
 * something was altered, since they don't need bit-exact recovery — but
 * the actual payload becomes unrecoverable. Rather than trying to
 * out-fight browser-level pixel rounding, callers detect this case up
 * front and steer to the always-reliable "append" method instead. */
export function hasRealTransparency(imageData: ImageData): boolean {
  const { data } = imageData;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return true;
  }
  return false;
}
