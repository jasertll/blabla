export type ConfidenceLevel = "CONFIRMED" | "HIGH CONFIDENCE" | "MEDIUM CONFIDENCE" | "LOW CONFIDENCE" | "UNVERIFIED";

export type IntelligenceFinding = { text: string; confidence: ConfidenceLevel; source: string };

export type IntelligenceAssessment = {
  whatWeKnow: IntelligenceFinding[];
  whatWeSuspect: IntelligenceFinding[];
  whyItMatters: string;
  relatedInfrastructure: string[];
  risk: "LOW" | "MEDIUM" | "HIGH";
  overallConfidence: ConfidenceLevel;
  sources: string[];
  nextSteps: string[];
};

export function buildDomainAssessment(target: string, data: any): IntelligenceAssessment {
  const whatWeKnow: IntelligenceFinding[] = [];
  const whatWeSuspect: IntelligenceFinding[] = [];
  const relatedInfrastructure: string[] = [];
  const sources = new Set<string>();
  const nextSteps: string[] = [];
  let riskScore = 0;

  // --- Direct, first-hand observations (we performed the lookup ourselves) ---
  if (data.dns?.a?.length) {
    whatWeKnow.push({ text: `Resolves to ${data.dns.a.join(", ")}`, confidence: "CONFIRMED", source: "Direct DNS resolution" });
    relatedInfrastructure.push(...data.dns.a);
    sources.add("DNS resolution (direct)");
    nextSteps.push(`Run ${data.dns.a[0]} through the IP Analyzer for open ports and CVEs.`);
  } else {
    whatWeKnow.push({ text: "No A record found", confidence: "CONFIRMED", source: "Direct DNS resolution" });
  }

  if (data.dns?.mx?.length) {
    whatWeKnow.push({ text: `Mail routed through ${data.dns.mx.map((m: any) => m.exchange).join(", ")}`, confidence: "CONFIRMED", source: "Direct DNS resolution" });
    sources.add("DNS resolution (direct)");
  }

  if (data.ssl?.status === "ok") {
    whatWeKnow.push({
      text: `Valid TLS certificate issued by ${data.ssl.data.issuer}, expiring in ${data.ssl.data.daysUntilExpiry} days`,
      confidence: "CONFIRMED",
      source: "Live TLS handshake (direct)",
    });
    sources.add("TLS handshake (direct)");
    if (data.ssl.data.daysUntilExpiry < 30) {
      riskScore += 15;
      nextSteps.push("Certificate expires soon — flag for renewal before it lapses.");
    }
  } else {
    whatWeKnow.push({ text: "No TLS certificate could be retrieved on port 443", confidence: "CONFIRMED", source: "Live TLS handshake (direct)" });
    riskScore += 10;
  }

  const hasSpf = Boolean(data.security?.spf);
  const hasDmarc = Boolean(data.security?.dmarc);
  whatWeKnow.push({
    text: `SPF ${hasSpf ? "present" : "absent"}, DMARC ${hasDmarc ? "present" : "absent"}`,
    confidence: "CONFIRMED",
    source: "Direct DNS TXT record lookup",
  });
  if (!hasSpf || !hasDmarc) {
    riskScore += 15;
    nextSteps.push("Missing email-authentication records make this domain easier to spoof for phishing — consider adding SPF/DMARC.");
  }

  // --- Third-party but authoritative sources ---
  if (data.whois?.status === "ok") {
    const created = data.whois.data.createdDate ? new Date(data.whois.data.createdDate) : null;
    if (created && !isNaN(created.getTime())) {
      const ageDays = Math.round((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
      whatWeKnow.push({
        text: `Registered ${created.toLocaleDateString()} (${ageDays.toLocaleString()} days ago) via ${data.whois.data.registrar ?? "unknown registrar"}`,
        confidence: "HIGH CONFIDENCE",
        source: "RDAP registry lookup",
      });
      sources.add("RDAP (registry)");
      if (ageDays < 30) {
        whatWeSuspect.push({ text: "Very recently registered — a pattern common with disposable phishing/malware infrastructure", confidence: "MEDIUM CONFIDENCE", source: "Heuristic: domain age" });
        riskScore += 30;
        nextSteps.push("Treat this domain with extra caution given its age until corroborated by other signals.");
      } else if (ageDays < 180) {
        whatWeSuspect.push({ text: "Registered under 6 months ago — worth a second look, though many legitimate domains are this young too", confidence: "LOW CONFIDENCE", source: "Heuristic: domain age" });
        riskScore += 10;
      }
    }
  } else {
    whatWeKnow.push({ text: "No registration data available via RDAP for this TLD", confidence: "UNVERIFIED", source: "RDAP registry lookup" });
  }

  nextSteps.push("Check for related subdomains and header hygiene via the Web App Security Scan.");
  nextSteps.push("If investigating a specific file from this domain, run its hash through the File Inspector.");

  const risk: IntelligenceAssessment["risk"] = riskScore >= 45 ? "HIGH" : riskScore >= 20 ? "MEDIUM" : "LOW";
  const overallConfidence: ConfidenceLevel = whatWeSuspect.length > 0 ? "MEDIUM CONFIDENCE" : "HIGH CONFIDENCE";

  const whyItMatters = risk === "HIGH"
    ? "Multiple signals here are consistent with disposable or higher-risk infrastructure (young registration, missing email-auth records, or certificate issues). None of these alone is proof of malicious intent, but together they warrant treating this domain as unverified until corroborated."
    : risk === "MEDIUM"
    ? "One or two signals here are worth a closer look, but nothing rises to a strong indicator on its own. Standard due diligence applies."
    : "The checked signals are consistent with an established, conventionally-configured domain. This does not rule out compromise or misuse of legitimate infrastructure — only that no red flags appeared in these specific checks.";

  return { whatWeKnow, whatWeSuspect, whyItMatters, relatedInfrastructure, risk, overallConfidence, sources: Array.from(sources), nextSteps };
}
