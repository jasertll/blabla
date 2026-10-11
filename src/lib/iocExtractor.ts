import { isPrivateOrReservedIp } from "./ipRanges";

export type ExtractedIocs = {
  ipv4: string[];
  domains: string[];
  urls: string[];
  emails: string[];
  md5: string[];
  sha1: string[];
  sha256: string[];
  cves: string[];
  wasDefanged: boolean;
};

const PATTERNS = {
  ipv4: /\b(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\b/g,
  url: /\bhttps?:\/\/[^\s"'<>)\]]+/gi,
  email: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
  domain: /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\b/g,
  sha256: /\b[a-fA-F0-9]{64}\b/g,
  sha1: /\b[a-fA-F0-9]{40}\b/g,
  md5: /\b[a-fA-F0-9]{32}\b/g,
  cve: /\bCVE-\d{4}-\d{4,7}\b/gi,
};

// Threat-intel reports and log exports routinely "defang" indicators so
// they can't be accidentally clicked/executed (hxxp://evil[.]com,
// 1[.]2[.]3[.]4, user[at]evil[.]com) — a naive extractor running against
// raw text misses every single one of these. Refanging first (real,
// well-documented conventions only) means the extractor actually finds
// what a real analyst pastes in from a report, not just a raw packet
// capture.
const DEFANG_RULES: [RegExp, string][] = [
  [/hxxps/gi, "https"],
  [/hxxp/gi, "http"],
  [/\[\.\]|\(\.\)|\{\.\}/g, "."],
  [/\[:\]/g, ":"],
  [/\[at\]|\(at\)/gi, "@"],
  [/\[@\]/g, "@"],
];

function refang(text: string): string {
  let out = text;
  for (const [pattern, replacement] of DEFANG_RULES) out = out.replace(pattern, replacement);
  return out;
}

// Domains that are almost always noise in log files (file extensions,
// version-like tokens) — filtered out of the "domains" bucket.
const NOISE_TLDS = new Set([
  "log", "txt", "exe", "dll", "json", "xml", "js", "css", "html", "png",
  "jpg", "jpeg", "gif", "svg", "conf", "cfg", "ini", "yml", "yaml", "csv",
  "zip", "gz", "tar", "bak", "tmp", "dat", "db", "sql", "class", "jar",
]);

export function extractIocs(rawText: string): ExtractedIocs {
  const text = refang(rawText);
  const wasDefanged = text !== rawText;

  const ipv4 = Array.from(new Set(text.match(PATTERNS.ipv4) ?? []));
  const urls = Array.from(new Set(text.match(PATTERNS.url) ?? []));
  const emails = Array.from(new Set(text.match(PATTERNS.email) ?? []));
  const cves = Array.from(new Set((text.match(PATTERNS.cve) ?? []).map((c) => c.toUpperCase())));

  const allDomains = Array.from(new Set(text.match(PATTERNS.domain) ?? []));
  const domains = allDomains.filter((d) => {
    const tld = d.split(".").pop()?.toLowerCase() ?? "";
    if (NOISE_TLDS.has(tld)) return false;
    if (/^\d+\.\d+$/.test(d)) return false; // version numbers like 1.2
    if (emails.some((e) => e.endsWith(d))) return false; // skip email domains here, they're already captured
    return true;
  });

  // Hash buckets are mutually exclusive by length; extract longest first
  // so a sha256 substring doesn't also get double-counted as noise.
  const sha256 = Array.from(new Set(text.match(PATTERNS.sha256) ?? []));
  const sha1Raw = Array.from(new Set(text.match(PATTERNS.sha1) ?? []));
  const md5Raw = Array.from(new Set(text.match(PATTERNS.md5) ?? []));
  const sha256Set = new Set(sha256);
  const sha1 = sha1Raw.filter((h) => !sha256Set.has(h));
  const md5 = md5Raw.filter((h) => !sha256Set.has(h) && !sha1.includes(h));

  return { ipv4, domains, urls, emails, md5, sha1, sha256, cves, wasDefanged };
}

export function totalCount(iocs: ExtractedIocs): number {
  return iocs.ipv4.length + iocs.domains.length + iocs.urls.length + iocs.emails.length + iocs.md5.length + iocs.sha1.length + iocs.sha256.length + iocs.cves.length;
}

export { isPrivateOrReservedIp };
