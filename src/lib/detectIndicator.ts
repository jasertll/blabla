export type IndicatorType =
  | "ipv4"
  | "ipv6"
  | "domain"
  | "url"
  | "md5"
  | "sha1"
  | "sha256"
  | "email"
  | "cve"
  | "unknown";

const PATTERNS: { type: IndicatorType; regex: RegExp }[] = [
  {
    type: "url",
    regex: /^https?:\/\/[^\s]+$/i,
  },
  {
    type: "cve",
    regex: /^cve-\d{4}-\d{4,}$/i,
  },
  {
    type: "email",
    regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
  {
    type: "ipv4",
    regex:
      /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/,
  },
  {
    type: "ipv6",
    regex: /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::1|::)$/,
  },
  { type: "sha256", regex: /^[a-fA-F0-9]{64}$/ },
  { type: "sha1", regex: /^[a-fA-F0-9]{40}$/ },
  { type: "md5", regex: /^[a-fA-F0-9]{32}$/ },
  {
    type: "domain",
    regex:
      /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9-]{1,63})+$/,
  },
];

/**
 * Classifies a raw user-supplied indicator string.
 * Order matters: more specific patterns (url, email, hash) are checked
 * before the broader domain pattern to avoid misclassification.
 */
export function detectIndicator(raw: string): IndicatorType {
  const value = raw.trim();
  if (!value) return "unknown";

  for (const { type, regex } of PATTERNS) {
    if (regex.test(value)) return type;
  }
  return "unknown";
}

export function indicatorLabel(type: IndicatorType): string {
  const labels: Record<IndicatorType, string> = {
    ipv4: "IPv4 Address",
    ipv6: "IPv6 Address",
    domain: "Domain",
    url: "URL",
    md5: "MD5 Hash",
    sha1: "SHA-1 Hash",
    sha256: "SHA-256 Hash",
    email: "Email Address",
    cve: "CVE Identifier",
    unknown: "Unrecognized",
  };
  return labels[type];
}
