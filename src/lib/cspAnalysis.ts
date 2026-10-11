// Real CSP directive-content analysis — a site can have a
// Content-Security-Policy header and still be functionally unprotected
// (script-src 'unsafe-inline', a bare '*' source, etc. are well-documented
// ways a CSP defeats its own purpose). Presence alone tells you nothing.

export type CspIssue = { directive: string; problem: string; severity: "high" | "medium" };

export type CspAnalysis = {
  found: boolean;
  issues: CspIssue[];
  tone: "good" | "warn" | "bad";
  summary: string;
};

function getDirective(policy: string, name: string): string | null {
  const directives = policy.split(";").map((d) => d.trim());
  const match = directives.find((d) => d.toLowerCase().startsWith(name + " ") || d.toLowerCase() === name);
  return match ?? null;
}

export function analyzeCsp(policy: string | null): CspAnalysis {
  if (!policy) {
    return { found: false, issues: [], tone: "bad", summary: "No Content-Security-Policy — the browser has no enforced defense against injected scripts." };
  }

  const issues: CspIssue[] = [];
  const scriptSrc = getDirective(policy, "script-src") ?? getDirective(policy, "default-src");

  if (scriptSrc) {
    if (/'unsafe-inline'/i.test(scriptSrc)) {
      issues.push({ directive: "script-src", problem: "Allows 'unsafe-inline' — inline <script> tags execute freely, which is exactly what CSP is meant to block for XSS defense", severity: "high" });
    }
    if (/'unsafe-eval'/i.test(scriptSrc)) {
      issues.push({ directive: "script-src", problem: "Allows 'unsafe-eval' — eval()/Function()/setTimeout(string) can run arbitrary injected code", severity: "high" });
    }
    if (/(^|\s)\*(\s|$)/.test(scriptSrc)) {
      issues.push({ directive: "script-src", problem: "Allows a bare wildcard (*) — scripts can be loaded from ANY origin", severity: "high" });
    }
  } else {
    issues.push({ directive: "script-src", problem: "No script-src or default-src directive — scripts aren't restricted by CSP at all", severity: "high" });
  }

  if (!getDirective(policy, "object-src") && !/(^|;)\s*default-src[^;]*'none'/i.test(policy)) {
    issues.push({ directive: "object-src", problem: "No object-src directive — legacy plugin content (Flash/Java applets) isn't restricted", severity: "medium" });
  }
  if (!getDirective(policy, "base-uri")) {
    issues.push({ directive: "base-uri", problem: "No base-uri directive — an injected <base> tag could hijack all relative URLs on the page", severity: "medium" });
  }
  if (!getDirective(policy, "frame-ancestors")) {
    issues.push({ directive: "frame-ancestors", problem: "No frame-ancestors directive — CSP provides no clickjacking protection (check X-Frame-Options separately)", severity: "medium" });
  }

  const highCount = issues.filter((i) => i.severity === "high").length;
  const tone: CspAnalysis["tone"] = highCount > 0 ? "bad" : issues.length > 0 ? "warn" : "good";
  const summary =
    highCount > 0
      ? `CSP is present but has ${highCount} high-severity weakening${highCount === 1 ? "" : "s"} that substantially undermine its XSS protection.`
      : issues.length > 0
        ? `CSP provides real protection but is missing some hardening directives.`
        : `CSP is present with no obvious weakening directives found.`;

  return { found: true, issues, tone, summary };
}
