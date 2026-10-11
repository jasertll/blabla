/** Shannon entropy in bits/byte, 0 (uniform) to 8 (fully random). High
 * entropy (roughly >7.2) suggests compression, encryption, or packing —
 * a common heuristic for flagging packed malware, not proof of it. */
export function shannonEntropy(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  const freq = new Map<number, number>();
  for (const b of bytes) freq.set(b, (freq.get(b) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / bytes.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export type EntropyProfile = {
  overall: number;
  blockSize: number;
  blocks: number[];
  /** Longest run of consecutive blocks at/above the high-entropy threshold. */
  highEntropyRun: { startBlock: number; length: number; startByte: number; endByte: number } | null;
};

/** A single aggregate entropy number treats "half the file is plaintext,
 * half is an encrypted blob" the same as "the whole file is uniformly
 * medium-random" — two very different situations. Splitting the file
 * into blocks and finding the longest contiguous run of high-entropy
 * blocks localizes exactly where a packed/encrypted payload would sit
 * inside an otherwise normal-looking file, which is a much sharper
 * signal than the single-number check alone. Block count is capped
 * (adaptive block size) so this stays fast on large files. */
export function computeEntropyProfile(bytes: Uint8Array, highThreshold = 7.2): EntropyProfile {
  const overall = shannonEntropy(bytes);
  if (bytes.length === 0) {
    return { overall, blockSize: 0, blocks: [], highEntropyRun: null };
  }

  const maxBlocks = 2048;
  const blockSize = Math.max(256, Math.ceil(bytes.length / maxBlocks));
  const blocks: number[] = [];
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    blocks.push(shannonEntropy(bytes.subarray(offset, Math.min(offset + blockSize, bytes.length))));
  }

  let bestRun: EntropyProfile["highEntropyRun"] = null;
  let runStart = -1;
  for (let i = 0; i <= blocks.length; i++) {
    const isHigh = i < blocks.length && blocks[i] >= highThreshold;
    if (isHigh && runStart === -1) {
      runStart = i;
    } else if (!isHigh && runStart !== -1) {
      const length = i - runStart;
      if (!bestRun || length > bestRun.length) {
        bestRun = { startBlock: runStart, length, startByte: runStart * blockSize, endByte: Math.min(i * blockSize, bytes.length) };
      }
      runStart = -1;
    }
  }

  return { overall, blockSize, blocks, highEntropyRun: bestRun };
}
