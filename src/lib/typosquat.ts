// Generates plausible lookalike domains for a target — pure string
// permutation, no network. The API route then checks which candidates
// are actually registered.

const HOMOGLYPHS: Record<string, string[]> = {
  o: ["0"],
  l: ["1", "i"],
  i: ["1", "l"],
  e: ["3"],
  a: ["4"],
  s: ["5", "z"],
  m: ["rn"],
  g: ["q"],
};

const ALT_TLDS = ["net", "org", "co", "info", "io", "biz", "xyz", "top"];

export type TyposquatCategory = "omission" | "duplication" | "transposition" | "homoglyph" | "hyphenation" | "tld-swap" | "combo-squat";

export type TyposquatCandidate = { domain: string; category: TyposquatCategory };

export function generateTyposquats(target: string, cap = 40): TyposquatCandidate[] {
  const clean = target.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const lastDot = clean.lastIndexOf(".");
  if (lastDot <= 0) return [];

  const name = clean.slice(0, lastDot);
  const tld = clean.slice(lastDot + 1);
  const out = new Map<string, TyposquatCandidate>();
  const add = (domain: string, category: TyposquatCategory) => {
    if (domain !== clean && !out.has(domain)) out.set(domain, { domain, category });
  };

  // Character omission — drop one character at a time
  for (let i = 0; i < name.length; i++) {
    add(`${name.slice(0, i)}${name.slice(i + 1)}.${tld}`, "omission");
  }

  // Character duplication — double one character at a time
  for (let i = 0; i < name.length; i++) {
    add(`${name.slice(0, i + 1)}${name[i]}${name.slice(i + 1)}.${tld}`, "duplication");
  }

  // Adjacent transposition — swap neighboring characters
  for (let i = 0; i < name.length - 1; i++) {
    const chars = name.split("");
    [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
    add(`${chars.join("")}.${tld}`, "transposition");
  }

  // Homoglyph substitution — visually similar characters/digits
  for (let i = 0; i < name.length; i++) {
    const subs = HOMOGLYPHS[name[i]];
    if (!subs) continue;
    for (const sub of subs) {
      add(`${name.slice(0, i)}${sub}${name.slice(i + 1)}.${tld}`, "homoglyph");
    }
  }

  // Hyphenation — insert a hyphen between two characters
  for (let i = 1; i < name.length; i++) {
    add(`${name.slice(0, i)}-${name.slice(i)}.${tld}`, "hyphenation");
  }

  // TLD swap — same name, different popular TLD
  for (const altTld of ALT_TLDS) {
    if (altTld !== tld) add(`${name}.${altTld}`, "tld-swap");
  }

  // Combo-squatting — common brand-protection/phishing prefixes & suffixes
  for (const affix of ["secure", "login", "verify", "account", "support"]) {
    add(`${affix}-${name}.${tld}`, "combo-squat");
    add(`${name}-${affix}.${tld}`, "combo-squat");
  }

  return Array.from(out.values()).slice(0, cap);
}
