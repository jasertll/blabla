// Real cryptographic hashes of the uploaded file's bytes. SHA-256/SHA-1
// via the browser's native Web Crypto API (same pattern as
// components/FileInspector.tsx's hashHex()). MD5 has no Web Crypto
// implementation (it's cryptographically broken and intentionally
// excluded from that API) — used here purely as the "MD5 compatibility
// hash" older tooling/allowlists still key on, via spark-md5, a small
// well-established pure-JS MD5 implementation, not a security primitive.
import SparkMD5 from "spark-md5";

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return bufferToHex(digest);
}

export async function sha1Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", buffer);
  return bufferToHex(digest);
}

export function md5Hex(buffer: ArrayBuffer): string {
  return SparkMD5.ArrayBuffer.hash(buffer);
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeAllHashes(buffer: ArrayBuffer): Promise<{ sha256: string; sha1: string; md5: string }> {
  const [sha256, sha1] = await Promise.all([sha256Hex(buffer), sha1Hex(buffer)]);
  return { sha256, sha1, md5: md5Hex(buffer) };
}
