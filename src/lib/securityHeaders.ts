export type HeaderCheck = {
  header: string;
  present: boolean;
  value: string | null;
  severity: "critical" | "recommended" | "info";
  note: string;
};

const CHECKS: { header: string; severity: HeaderCheck["severity"]; note: string }[] = [
  {
    header: "strict-transport-security",
    severity: "critical",
    note: "Without HSTS, users can be downgraded to plain HTTP by a network attacker (SSL stripping).",
  },
  {
    header: "content-security-policy",
    severity: "critical",
    note: "Without CSP, the site has no browser-enforced defense against XSS/injection attacks.",
  },
  {
    header: "x-content-type-options",
    severity: "recommended",
    note: "Missing this lets browsers MIME-sniff responses, which can turn an upload endpoint into an XSS vector.",
  },
  {
    header: "x-frame-options",
    severity: "recommended",
    note: "Without this (or a frame-ancestors CSP directive), the site can be embedded in a clickjacking iframe.",
  },
  {
    header: "referrer-policy",
    severity: "recommended",
    note: "Without this, full URLs (sometimes containing tokens/session data) can leak to third parties via the Referer header.",
  },
  {
    header: "permissions-policy",
    severity: "info",
    note: "Restricts which browser features (camera, geolocation, etc.) the page and any embedded content can use.",
  },
];

export function evaluateHeaders(headers: Headers): { checks: HeaderCheck[]; grade: string; score: number } {
  const checks: HeaderCheck[] = CHECKS.map((c) => {
    const value = headers.get(c.header);
    return { header: c.header, present: value !== null, value, severity: c.severity, note: c.note };
  });

  const weights = { critical: 2, recommended: 1, info: 0.5 };
  const maxScore = checks.reduce((sum, c) => sum + weights[c.severity], 0);
  const score = checks.reduce((sum, c) => sum + (c.present ? weights[c.severity] : 0), 0);
  const pct = maxScore > 0 ? score / maxScore : 0;

  const grade = pct >= 0.9 ? "A" : pct >= 0.7 ? "B" : pct >= 0.5 ? "C" : pct >= 0.3 ? "D" : "F";

  return { checks, grade, score: Math.round(pct * 100) };
}
