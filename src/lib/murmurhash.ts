// Standard MurmurHash3 x86_32 (Austin Appleby's reference algorithm),
// seed 0 by default. Used by lib/faviconHash.ts to reproduce the same
// hash Shodan/Censys index favicons under, so results are pivotable
// against their search UIs.
export function murmur3_32(input: string, seed = 0): number {
  const bytes = Buffer.from(input, "utf-8");
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const len = bytes.length;
  const nblocks = Math.floor(len / 4);
  let h1 = seed >>> 0;

  for (let i = 0; i < nblocks; i++) {
    const off = i * 4;
    let k1 =
      (bytes[off] & 0xff) |
      ((bytes[off + 1] & 0xff) << 8) |
      ((bytes[off + 2] & 0xff) << 16) |
      ((bytes[off + 3] & 0xff) << 24);

    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);

    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
  }

  let k1 = 0;
  const tail = nblocks * 4;
  switch (len & 3) {
    case 3:
      k1 ^= (bytes[tail + 2] & 0xff) << 16;
    // falls through
    case 2:
      k1 ^= (bytes[tail + 1] & 0xff) << 8;
    // falls through
    case 1:
      k1 ^= bytes[tail] & 0xff;
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
  }

  h1 ^= len;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;

  return h1 | 0; // signed 32-bit, matching Python's mmh3.hash() default
}
