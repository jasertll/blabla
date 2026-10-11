export type StoredCanaryFile = {
  data: string; // base64
  contentType: string;
  filename: string;
};

// Kept intentionally small — the file lives as a base64 string inside a
// single Redis value, and Upstash's free/typical plans cap request
// payload size in the low single-digit megabytes. Base64 costs about
// 33% overhead, so this is the raw-file ceiling, not the stored size.
export const MAX_LINK_FILE_BYTES = 4 * 1024 * 1024;

// Deliberately NOT trusting the browser-declared file.type (or the
// filename's extension) for what gets stored and later served back as
// this file's Content-Type — a client can set that header to anything,
// including text/html, and since the CSP allows 'unsafe-inline' script,
// a tracked link serving attacker-supplied content as text/html would
// be a stored XSS on this domain for whoever opens it. Sniffing the
// actual bytes and only ever returning one of these six fixed MIME
// strings means the served Content-Type can never be anything other
// than what it's declared to be here, regardless of what was uploaded
// or how it was labeled.
const SIGNATURES: { contentType: string; matches: (b: Uint8Array) => boolean }[] = [
  { contentType: "application/pdf", matches: (b) => startsWithAscii(b, "%PDF-") },
  { contentType: "image/jpeg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    contentType: "image/png",
    matches: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a,
  },
  { contentType: "image/gif", matches: (b) => startsWithAscii(b, "GIF87a") || startsWithAscii(b, "GIF89a") },
  {
    contentType: "image/webp",
    matches: (b) => startsWithAscii(b, "RIFF") && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  { contentType: "image/bmp", matches: (b) => b[0] === 0x42 && b[1] === 0x4d },
];

function startsWithAscii(bytes: Uint8Array, ascii: string): boolean {
  if (bytes.length < ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

// Returns the verified MIME type for a supported file based on its
// actual bytes, or null if it doesn't match any supported format —
// this is both the allowlist check and the source of truth for what
// gets stored, in one pass.
export function sniffSupportedContentType(bytes: Uint8Array): string | null {
  for (const sig of SIGNATURES) {
    if (sig.matches(bytes)) return sig.contentType;
  }
  return null;
}

// Builds the purely cosmetic trailing path segment /api/canary/link
// appends to a tracked-link URL — see the [[...filename]] route
// comment for why it's cosmetic (the token is still the only thing
// that determines what comes back). This is what makes the raw URL
// itself read like a normal document link at a glance, which is the
// only option when a link can only be shared as plain text (no rich
// hyperlink) — Arabic/Latin letters and digits pass through as-is
// (URL-encoded, but browsers decode that back to readable text in the
// address bar), everything else collapses to a hyphen.
export function buildCosmeticFilename(label: string, originalName: string): string {
  const ext = /\.[^.]+$/.exec(originalName)?.[0] ?? "";
  const base =
    label
      .trim()
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .replace(/\s+/g, "-")
      .slice(0, 60)
      .trim() || "document";
  return `${base}${ext}`;
}
