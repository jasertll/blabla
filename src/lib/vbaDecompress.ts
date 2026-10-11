// MS-OVBA 2.4.1 "Compression" algorithm — decompresses the raw bytes of
// a VBA source-code module stream stored inside an Office document's
// vbaProject.bin. Ported faithfully from oletools' decompress_stream()
// (github.com/decalage2/oletools, olevba.py) — the reference open-source
// implementation the malware-analysis/DFIR community actually uses —
// rather than guessed at, since a bit-width error here would silently
// corrupt every extracted macro.

function copytokenHelp(decompressedCurrent: number, decompressedChunkStart: number) {
  const difference = decompressedCurrent - decompressedChunkStart;
  let bitCount = Math.ceil(Math.log2(Math.max(difference, 1)));
  bitCount = Math.max(bitCount, 4);
  const lengthMask = 0xffff >>> bitCount;
  const offsetMask = ~lengthMask & 0xffff;
  return { lengthMask, offsetMask, bitCount };
}

/** Throws on malformed input (invalid signature byte, bad chunk
 * signature) rather than silently returning garbage — callers treat a
 * thrown error as "not a valid MS-OVBA compressed stream". */
export function decompressVbaStream(compressed: Uint8Array): Uint8Array {
  if (compressed.length === 0 || compressed[0] !== 0x01) {
    throw new Error("invalid MS-OVBA signature byte");
  }
  const out: number[] = [];
  let pos = 1;

  while (pos < compressed.length) {
    if (pos + 2 > compressed.length) break;
    const chunkStart = pos;
    const header = compressed[chunkStart] | (compressed[chunkStart + 1] << 8);
    const chunkSize = (header & 0x0fff) + 3;
    const chunkSignature = (header >>> 12) & 0x07;
    if (chunkSignature !== 0b011) throw new Error("invalid CompressedChunkSignature");
    const chunkFlag = (header >>> 15) & 0x01;
    if (chunkFlag === 1 && chunkSize > 4098) throw new Error("CompressedChunkSize > 4098 with flag=1");

    const compressedEnd = Math.min(compressed.length, chunkStart + chunkSize);
    pos = chunkStart + 2;

    if (chunkFlag === 0) {
      // RawChunk: next 4096 bytes copied verbatim.
      for (let i = 0; i < 4096 && pos < compressed.length; i++, pos++) out.push(compressed[pos]);
    } else {
      const decompressedChunkStart = out.length;
      while (pos < compressedEnd) {
        const flagByte = compressed[pos];
        pos++;
        for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
          if (pos >= compressedEnd) break;
          const flagBit = (flagByte >>> bitIndex) & 1;
          if (flagBit === 0) {
            // LiteralToken
            out.push(compressed[pos]);
            pos++;
          } else {
            // CopyToken
            const token = compressed[pos] | (compressed[pos + 1] << 8);
            const { lengthMask, offsetMask, bitCount } = copytokenHelp(out.length, decompressedChunkStart);
            const length = (token & lengthMask) + 3;
            const temp1 = token & offsetMask;
            const offset = (temp1 >>> (16 - bitCount)) + 1;
            const copySource = out.length - offset;
            if (copySource < 0) throw new Error("invalid CopyToken offset");
            for (let i = 0; i < length; i++) out.push(out[copySource + i]);
            pos += 2;
          }
        }
      }
    }
  }

  return new Uint8Array(out);
}
