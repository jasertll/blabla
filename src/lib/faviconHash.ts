import { murmur3_32 } from "@/lib/murmurhash";

// Reproduces the exact hash Shodan/Censys index favicons under, so a
// hash computed here is directly pivotable against their search UIs:
// Shodan hashes base64.encodebytes(favicon_bytes) — standard base64,
// line-wrapped at 76 chars with a trailing newline on every line
// (including the last) — through MurmurHash3 x86_32, seed 0.
export function shodanFaviconHash(bytes: Uint8Array): number {
  const b64 = Buffer.from(bytes).toString("base64");
  let wrapped = "";
  for (let i = 0; i < b64.length; i += 76) {
    wrapped += b64.slice(i, i + 76) + "\n";
  }
  return murmur3_32(wrapped, 0);
}
