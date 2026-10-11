// Flags subdomains whose NAME suggests they're higher-value recon targets —
// the same "interesting hostnames" heuristic real attack-surface tooling
// (e.g. subdomain enumerators feeding into further probing) applies. This
// is pattern matching on the label itself, not a claim about what's
// actually running there — phrased that way in the UI.

export type SubdomainFlag = { keyword: string; reason: string };

const FLAG_RULES: { pattern: RegExp; keyword: string; reason: string }[] = [
  { pattern: /(^|\.)admin(\.|$)/i, keyword: "admin", reason: "Administrative panels are common high-value targets" },
  { pattern: /(^|\.)(vpn|remote|citrix|rdp)(\.|$)/i, keyword: "remote access", reason: "Remote-access infrastructure — a common initial-access target" },
  { pattern: /(^|\.)(staging|stage|dev|test|qa|uat|demo)(\.|$)/i, keyword: "non-production", reason: "Non-production environments often run weaker hardening/auth than production" },
  { pattern: /(^|\.)(internal|intranet|corp)(\.|$)/i, keyword: "internal", reason: "Named as internal-only — shouldn't typically be reachable from the public internet" },
  { pattern: /(^|\.)(backup|bak|old|legacy)(\.|$)/i, keyword: "backup/legacy", reason: "Backup or legacy systems are often unpatched and forgotten" },
  { pattern: /(^|\.)(git|gitlab|jenkins|jira|confluence|bamboo|teamcity)(\.|$)/i, keyword: "dev tooling", reason: "Exposed developer/CI tooling can leak source code or secrets if misconfigured" },
  { pattern: /(^|\.)(grafana|kibana|elastic|prometheus)(\.|$)/i, keyword: "monitoring", reason: "Exposed monitoring dashboards can leak internal topology/metrics" },
  { pattern: /(^|\.)(phpmyadmin|pma|adminer)(\.|$)/i, keyword: "db admin", reason: "Database admin panels are a frequent, high-impact compromise target" },
  { pattern: /(^|\.)(ftp|sftp)(\.|$)/i, keyword: "file transfer", reason: "File-transfer services are commonly targeted for credential brute-forcing" },
  { pattern: /(^|\.)(sso|auth|login|okta)(\.|$)/i, keyword: "identity", reason: "Authentication/SSO endpoints are high-value phishing and credential-stuffing targets" },
  { pattern: /(^|\.)(api-internal|api-dev|api-staging)(\.|$)/i, keyword: "internal API", reason: "Internal-facing API surface not meant for public use" },
];

export function flagSubdomain(name: string): SubdomainFlag[] {
  const flags: SubdomainFlag[] = [];
  for (const rule of FLAG_RULES) {
    if (rule.pattern.test(name)) flags.push({ keyword: rule.keyword, reason: rule.reason });
  }
  return flags;
}

export function flagSubdomains(names: string[]): Map<string, SubdomainFlag[]> {
  const out = new Map<string, SubdomainFlag[]>();
  for (const name of names) {
    const flags = flagSubdomain(name);
    if (flags.length > 0) out.set(name, flags);
  }
  return out;
}
