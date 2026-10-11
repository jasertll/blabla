// Pure entity extraction over OCR'd text — split from the OCR engine
// itself (ocrEngine.ts, which needs a real browser + tesseract.js) so
// the extraction regexes are independently unit-testable against known
// text, matching this codebase's existing split for iocExtractor.ts.
import type { SearchQueryCandidate } from "./types";

const URL_RE = /\bhttps?:\/\/[^\s"'<>)\]]+/gi;
// Bare domain (no scheme) — common in on-screen text ("visit example.com").
// Deliberately conservative TLD list avoidance: requires a known-shape
// TLD (2-24 letters) to cut down on false positives from OCR noise.
const BARE_DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi;
const EMAIL_RE = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}\b/g;
const HASHTAG_RE = /#[a-zA-Z0-9_]{2,100}\b/g;
// @handle — platform-agnostic (Twitter/X, Instagram, TikTok all use the
// same @handle convention); 2-30 chars matches every major platform's
// own username length limits.
const USERNAME_RE = /@[a-zA-Z0-9_.]{2,30}\b/g;
const PHONE_RE = /\b(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g;

function unique(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

export type OcrEntities = {
  urls: string[];
  domains: string[];
  emails: string[];
  hashtags: string[];
  usernames: string[];
  phoneNumbers: string[];
};

export function extractEntities(text: string): OcrEntities {
  const urls = unique((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, "")));
  const urlHosts = urls.map((u) => {
    try {
      return new URL(u).hostname.toLowerCase();
    } catch {
      return null;
    }
  }).filter((h): h is string => h !== null);

  const bareDomainCandidates = (text.match(BARE_DOMAIN_RE) ?? []).map((d) => d.toLowerCase());
  // Drop candidates that are really just the host part of a URL already captured above.
  const domains = unique([...urlHosts, ...bareDomainCandidates.filter((d) => !urlHosts.includes(d))]);

  const emails = unique(text.match(EMAIL_RE) ?? []);
  const hashtags = unique(text.match(HASHTAG_RE) ?? []);
  const usernames = unique(text.match(USERNAME_RE) ?? []);
  const phoneNumbers = unique(
    (text.match(PHONE_RE) ?? []).filter((p) => p.replace(/\D/g, "").length >= 7) // drop short numeric noise (dates, counts)
  );

  return { urls, domains, emails, hashtags, usernames, phoneNumbers };
}

/** Builds ranked, reproducible search-query candidates from extracted
 * OCR entities and the raw text — displayed to the analyst as DATA
 * (query + type + reason), never auto-executed against anything. The
 * original OCR text is always kept separately (see types.ts's
 * OcrExtraction.rawText) — this only generates suggestions. */
export function generateSearchQueries(entities: OcrEntities, rawText: string): SearchQueryCandidate[] {
  const queries: SearchQueryCandidate[] = [];

  for (const u of entities.usernames) {
    const handle = u.replace(/^@/, "");
    queries.push({ query: `"${handle}"`, type: "username", reason: `@-handle detected in image text`, priority: 90 });
  }
  for (const url of entities.urls) {
    queries.push({ query: url, type: "url", reason: "Full URL detected in image text", priority: 95 });
  }
  for (const domain of entities.domains) {
    if (entities.urls.some((u) => u.includes(domain))) continue; // already covered by the URL query above
    queries.push({ query: domain, type: "domain", reason: "Domain-like text detected in image", priority: 70 });
  }
  for (const tag of entities.hashtags) {
    queries.push({ query: tag, type: "hashtag", reason: "Hashtag detected in image text", priority: 60 });
  }

  // Distinctive exact-phrase candidates from the raw text: lines of
  // meaningful length (not too short to be noise, not the whole OCR
  // dump) that aren't already captured as a structured entity above.
  const lines = rawText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 12 && l.length <= 120)
    .filter((l) => !/^https?:\/\//i.test(l));
  for (const line of unique(lines).slice(0, 8)) {
    queries.push({ query: `"${line}"`, type: "ocr-exact-phrase", reason: "Distinctive text line detected via OCR", priority: 50 });
  }

  return queries.sort((a, b) => b.priority - a.priority);
}
