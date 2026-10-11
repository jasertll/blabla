// All of this directory runs in the browser — the raw file bytes never
// leave the machine except the resulting SHA-256 hash, which goes to
// /api/osint/hash (CIRCL hashlookup, keyless, public known-good-file
// database).

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
