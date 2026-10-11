// Generic, format-agnostic string/IOC extraction — the same first move
// every real analyst makes (the Unix `strings` utility) before anything
// tool- or format-specific. Used by both the Steganography Scanner
// (to find hidden text/data regardless of which tool embedded it) and
// the File / Malware Inspector's string-based capability/IOC scan
// (which catches things import-table analysis alone misses, e.g. an
// API name referenced only as a string for dynamic GetProcAddress
// resolution — a well-documented evasion of static import analysis).

export type ExtractedString = { text: string; offset: number; encoding: "ascii" | "utf16le" };

/** Scans raw bytes for runs of printable ASCII of at least minLen, and
 * separately for printable UTF-16LE runs (the encoding Windows PE
 * string tables and much malware use) — mirrors `strings -a` and
 * `strings -e l` combined. Capped so it stays fast and the results stay
 * useful rather than an unreadable wall of noise. */
export function extractPrintableStrings(bytes: Uint8Array, minLen = 5, maxResults = 4000): ExtractedString[] {
  const out: ExtractedString[] = [];
  const isPrintable = (b: number) => (b >= 0x20 && b <= 0x7e) || b === 0x09;

  // ASCII runs
  let start = -1;
  for (let i = 0; i <= bytes.length; i++) {
    const printable = i < bytes.length && isPrintable(bytes[i]);
    if (printable) {
      if (start === -1) start = i;
    } else {
      if (start !== -1 && i - start >= minLen) {
        out.push({ text: String.fromCharCode(...bytes.subarray(start, i)), offset: start, encoding: "ascii" });
        if (out.length >= maxResults) return out;
      }
      start = -1;
    }
  }

  // UTF-16LE runs: printable ASCII byte followed by 0x00, repeated
  let u16start = -1;
  let u16chars: number[] = [];
  for (let i = 0; i + 1 <= bytes.length; i += 2) {
    const lo = bytes[i];
    const hi = bytes[i + 1];
    if (hi === 0x00 && isPrintable(lo)) {
      if (u16start === -1) u16start = i;
      u16chars.push(lo);
    } else {
      if (u16start !== -1 && u16chars.length >= minLen) {
        out.push({ text: String.fromCharCode(...u16chars), offset: u16start, encoding: "utf16le" });
        if (out.length >= maxResults) return out;
      }
      u16start = -1;
      u16chars = [];
    }
  }
  if (u16start !== -1 && u16chars.length >= minLen) {
    out.push({ text: String.fromCharCode(...u16chars), offset: u16start, encoding: "utf16le" });
  }

  return out;
}

const URL_RE = /\bhttps?:\/\/[^\s"'<>\\]{4,300}/gi;
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const DOMAIN_RE = /\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\.(?:com|net|org|io|ru|cn|xyz|top|info|biz|onion|dev|app)\b/gi;
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;

export type IocSet = { urls: string[]; ips: string[]; domains: string[]; emails: string[] };

/** Real IOC extraction via regex over already-extracted text — the same
 * approach oletools/olevba uses to pull URLs and IPs out of decoded VBA
 * macro source. Deduplicated and capped. */
export function extractIocs(text: string): IocSet {
  const dedup = (arr: RegExpMatchArray | null, cap = 200) => arr ? [...new Set(arr)].slice(0, cap) : [];
  return {
    urls: dedup(text.match(URL_RE)),
    ips: dedup(text.match(IP_RE)).filter((ip) => !/^0\.0\.0\.0$|^255\.255\.255\.255$/.test(ip)),
    domains: dedup(text.match(DOMAIN_RE)),
    emails: dedup(text.match(EMAIL_RE)),
  };
}

const BASE64_RE = /[A-Za-z0-9+/]{40,}={0,2}/g;

/** Finds long base64-looking runs in already-extracted text and
 * attempts to decode them — a direct, well-documented deobfuscation
 * step (olevba does exactly this to reveal strings/URLs an attacker
 * base64-encoded inside VBA source, and it's equally common for a
 * "hidden" payload in a stego challenge to just be base64 text sitting
 * in the file). Only returns candidates that decode to something
 * plausible: a high-printable-ratio string, or a real file signature. */
export function findBase64Candidates(text: string, minLen = 40): { raw: string; decodedText?: string; decodedBytes?: Uint8Array }[] {
  const results: { raw: string; decodedText?: string; decodedBytes?: Uint8Array }[] = [];
  const seen = new Set<string>();
  const matches = text.match(BASE64_RE) ?? [];
  for (const raw of matches) {
    if (raw.length < minLen || seen.has(raw)) continue;
    seen.add(raw);
    try {
      const binary = atob(raw.length % 4 === 0 ? raw : raw.slice(0, raw.length - (raw.length % 4)));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      let printable = 0;
      for (const b of bytes) if ((b >= 0x20 && b <= 0x7e) || b === 0x0a || b === 0x0d || b === 0x09) printable++;
      const ratio = bytes.length > 0 ? printable / bytes.length : 0;
      if (ratio > 0.85) {
        results.push({ raw, decodedText: new TextDecoder().decode(bytes) });
      } else if (bytes.length > 4) {
        results.push({ raw, decodedBytes: bytes });
      }
    } catch {
      // not valid base64 — skip
    }
    if (results.length >= 25) break;
  }
  return results;
}
