import { lookupPort } from "./portIntel";
import { analyzeSpf, analyzeDmarc } from "./emailAuthAnalysis";
import type { CameraSignals } from "./cameraDetection";

export type ScoreFactor = { points: number; reason: string };

export type TransparentScore = {
  total: number;
  factors: ScoreFactor[];
  label: "LOW" | "MEDIUM" | "HIGH";
};

function finalize(factors: ScoreFactor[]): TransparentScore {
  const total = Math.min(100, factors.reduce((sum, f) => sum + f.points, 0));
  const label: TransparentScore["label"] = total >= 55 ? "HIGH" : total >= 25 ? "MEDIUM" : "LOW";
  return { total, factors, label };
}

export function scoreDomain(data: any): TransparentScore {
  const factors: ScoreFactor[] = [];

  const hasSpf = Boolean(data.security?.spf);
  const hasDmarc = Boolean(data.security?.dmarc);
  if (!hasSpf) {
    factors.push({ points: 15, reason: "No SPF record — domain easier to spoof for phishing" });
  } else {
    const spf = analyzeSpf(data.security.spf);
    if (spf.qualifier === "pass-all") factors.push({ points: 20, reason: "SPF ends in +all — explicitly authorizes ANY server to send mail as this domain, worse than having no SPF at all" });
    else if (spf.qualifier === "neutral" || spf.qualifier === "softfail") factors.push({ points: 8, reason: `SPF uses a weak qualifier (${spf.qualifier}) instead of a hard fail (-all)` });
    if (spf.overLookupLimit) factors.push({ points: 5, reason: `SPF record has ${spf.lookupMechanisms} DNS-lookup mechanisms, over RFC 7208's 10-lookup limit — can cause SPF to fail open` });
  }
  if (!hasDmarc) {
    factors.push({ points: 15, reason: "No DMARC record — no enforcement policy against spoofing" });
  } else {
    const dmarc = analyzeDmarc(data.security.dmarc);
    if (dmarc.policy === "none") factors.push({ points: 12, reason: "DMARC policy is p=none — monitoring only, spoofed mail is still delivered normally" });
    else if (dmarc.pct < 100) factors.push({ points: 5, reason: `DMARC only applies to ${dmarc.pct}% of mail (pct=${dmarc.pct})` });
  }

  if (data.ssl?.status !== "ok") {
    factors.push({ points: 20, reason: "No valid TLS certificate could be retrieved" });
  } else if (data.ssl.data.daysUntilExpiry < 14) {
    factors.push({ points: 10, reason: `TLS certificate expires in ${data.ssl.data.daysUntilExpiry} days` });
  }

  if (data.whois?.status === "ok" && data.whois.data.createdDate) {
    const ageDays = Math.round((Date.now() - new Date(data.whois.data.createdDate).getTime()) / (1000 * 60 * 60 * 24));
    if (ageDays < 30) factors.push({ points: 30, reason: `Domain registered only ${ageDays} days ago — common pattern for disposable/phishing infrastructure` });
    else if (ageDays < 180) factors.push({ points: 10, reason: `Domain registered ${ageDays} days ago — relatively young` });
  } else {
    factors.push({ points: 5, reason: "No registration date available to assess domain age" });
  }

  if (factors.length === 0) factors.push({ points: 0, reason: "No risk signals detected in the checks performed" });

  return finalize(factors);
}

/** cveID -> true if CISA's KEV catalog confirms it's being actively
 * exploited in the wild right now — the single strongest real signal
 * available here, so it's weighted far above a plain "has a CVE"
 * factor rather than folded into the same bucket. Optional: when the
 * caller hasn't fetched KEV data (e.g. offline/rate-limited), this
 * degrades gracefully to the original CVE-count-only factor. */
export function scoreIp(data: any, kevMatchedCveIds: string[] = []): TransparentScore {
  const factors: ScoreFactor[] = [];

  const vulns: string[] = data.internetdb?.status === "ok" ? data.internetdb.data.vulns : [];
  const ports: number[] = data.internetdb?.status === "ok" ? data.internetdb.data.ports : [];
  const kevSet = new Set(kevMatchedCveIds.map((c) => c.toUpperCase()));
  const kevHits = vulns.filter((v) => kevSet.has(v.toUpperCase()));
  const plainVulns = vulns.filter((v) => !kevSet.has(v.toUpperCase()));

  if (kevHits.length > 0) {
    factors.push({
      points: Math.min(60, kevHits.length * 35),
      reason: `${kevHits.length} of this host's CVE${kevHits.length === 1 ? "" : "s"} (${kevHits.join(", ")}) ${kevHits.length === 1 ? "is" : "are"} on CISA's Known Exploited Vulnerabilities catalog — confirmed active exploitation in the wild, not just a theoretical weakness`,
    });
  }
  if (plainVulns.length > 0) {
    factors.push({ points: Math.min(30, plainVulns.length * 12), reason: `${plainVulns.length} other known CVE${plainVulns.length === 1 ? "" : "s"} on record for this host` });
  }

  // Correlated signal: an "elevated" port (bare databases, RDP/SMB/VNC —
  // see lib/portIntel.ts) reachable from the internet AND a confirmed
  // vulnerability on the same host together are a materially stronger
  // combined signal than either fact reported alone — the same
  // "correlation beats a flat sum" principle used in this app's
  // file-analysis risk scoring (lib/fileAnalysis/verdicts.ts).
  const elevatedPorts = ports.filter((p) => lookupPort(p).risk === "elevated");
  if (elevatedPorts.length > 0 && (kevHits.length > 0 || plainVulns.length > 0)) {
    factors.push({
      points: 15,
      reason: `${elevatedPorts.length} directly-exposed high-risk service${elevatedPorts.length === 1 ? "" : "s"} (${elevatedPorts.map((p) => lookupPort(p).service).join(", ")}) on a host that ALSO has a known vulnerability — exposure and flaw together, not just one or the other`,
    });
  } else if (elevatedPorts.length > 0) {
    factors.push({
      points: Math.min(20, elevatedPorts.length * 8),
      reason: `${elevatedPorts.length} directly-exposed high-risk service${elevatedPorts.length === 1 ? "" : "s"} (${elevatedPorts.map((p) => lookupPort(p).service).join(", ")}) — databases/remote-access services reachable from the internet are a common initial-access and mass-scanning target regardless of CVEs`,
    });
  }
  if (ports.length > 5) {
    factors.push({ points: 10, reason: `${ports.length} open ports — larger attack surface than typical` });
  }
  if (data.tor?.status === "ok" && data.tor.data.isTorExitNode) {
    factors.push({ points: 25, reason: "Confirmed Tor exit node — traffic origin cannot be attributed to a specific actor" });
  }
  if (data.blacklist?.status === "ok" && data.blacklist.data.listed) {
    factors.push({ points: 30, reason: "Listed on Spamhaus ZEN — a widely-used real-time spam/abuse blacklist" });
  }
  if (data.geo?.status === "ok" && data.geo.data.isProxy) {
    factors.push({ points: 15, reason: "Flagged as a proxy/anonymization service by ip-api.com" });
  }
  if (data.geo?.status === "ok" && data.geo.data.isHosting) {
    factors.push({ points: 5, reason: "Hosting/datacenter IP — normal for servers, worth noting for expected-residential contexts" });
  }

  if (factors.length === 0) factors.push({ points: 0, reason: "No risk signals detected in the checks performed" });

  return finalize(factors);
}

/** Scores a Web App Security Scan result — correlates header grade, CSP
 * strength, cookie flags, CORS reflection, exposed sensitive files, and
 * weak TLS into one transparent score, same "every point has a named
 * reason" contract as scoreDomain/scoreIp. */
export function scoreWebApp(data: any): TransparentScore {
  const factors: ScoreFactor[] = [];

  if (data.headerScan?.status !== "ok") {
    factors.push({ points: 10, reason: "Could not complete the security-header scan (site unreachable over HTTP/HTTPS)" });
    return finalize(factors);
  }

  if (data.headerScan.grade === "F" || data.headerScan.grade === "D") {
    factors.push({ points: 15, reason: `Security-header grade ${data.headerScan.grade} — most recommended browser-enforced protections are missing` });
  }

  if (data.csp) {
    const highIssues = (data.csp.issues ?? []).filter((i: any) => i.severity === "high");
    if (!data.csp.found) factors.push({ points: 15, reason: "No Content-Security-Policy at all" });
    else if (highIssues.length > 0) factors.push({ points: 15, reason: `CSP present but weakened (${highIssues.map((i: any) => i.problem).join("; ")})` });
  }

  if (data.cookies?.length) {
    const sessionIssues = data.cookies.filter((c: any) => c.looksLikeSession && c.issues.length > 0);
    if (sessionIssues.length > 0) {
      factors.push({ points: 20, reason: `${sessionIssues.length} session-like cookie${sessionIssues.length === 1 ? "" : "s"} missing hardening flags (${sessionIssues.map((c: any) => c.name).join(", ")})` });
    }
  }

  if (data.cors?.allowsCredentialsWithReflection) {
    factors.push({ points: 30, reason: "CORS reflects any Origin AND allows credentials — any website can read authenticated responses from this site on a visitor's behalf" });
  } else if (data.cors?.reflectsArbitraryOrigin) {
    factors.push({ points: 8, reason: "CORS reflects an arbitrary Origin back (without credentials) — broader than typical intent" });
  }

  if (data.owasp) {
    if (data.owasp.weakTls) factors.push({ points: 20, reason: `Negotiated a deprecated TLS protocol (${data.owasp.tlsProtocol})` });
    const exposedCount = data.owasp.exposedFiles?.filter((f: any) => f.exposed).length ?? 0;
    if (exposedCount > 0) factors.push({ points: Math.min(30, exposedCount * 15), reason: `${exposedCount} sensitive file path${exposedCount === 1 ? "" : "s"} publicly reachable (${data.owasp.exposedFiles.filter((f: any) => f.exposed).map((f: any) => f.path).join(", ")})` });
    if (data.owasp.serverVersionDisclosed) factors.push({ points: 5, reason: "Server software version disclosed in response headers" });
  }

  if (factors.length === 0) factors.push({ points: 0, reason: "No risk signals detected in the checks performed" });

  return finalize(factors);
}

/** Scores a CCTV/IoT camera check — weighs KEV-confirmed CVEs far above
 * a plain CVE count (camera/DVR botnet exploitation, e.g. Mirai-class
 * activity, is one of the most common real KEV categories), plus
 * internet-facing exposure of camera-specific management ports. */
export function scoreCamera(internetdb: { ports: number[]; vulns: string[] }, signals: CameraSignals, kevMatchedCveIds: string[] = []): TransparentScore {
  const factors: ScoreFactor[] = [];

  const kevSet = new Set(kevMatchedCveIds.map((c) => c.toUpperCase()));
  const kevHits = internetdb.vulns.filter((v) => kevSet.has(v.toUpperCase()));
  const plainVulns = internetdb.vulns.filter((v) => !kevSet.has(v.toUpperCase()));

  if (kevHits.length > 0) {
    factors.push({
      points: Math.min(60, kevHits.length * 35),
      reason: `${kevHits.length} CVE${kevHits.length === 1 ? "" : "s"} (${kevHits.join(", ")}) on CISA's Known Exploited Vulnerabilities catalog — camera/DVR botnets (Mirai-class) are one of the most common real KEV exploitation categories`,
    });
  }
  if (plainVulns.length > 0) {
    factors.push({ points: Math.min(25, plainVulns.length * 10), reason: `${plainVulns.length} other known CVE${plainVulns.length === 1 ? "" : "s"} on record for this device` });
  }
  if (signals.isLikelyCamera) {
    factors.push({ points: 20, reason: `Camera/DVR management interface directly reachable from the internet${signals.vendorGuess ? ` (likely ${signals.vendorGuess})` : ""} — the single biggest risk factor regardless of CVEs` });
  }
  if (signals.criticalPorts.some((p) => p.port === 554 || p.port === 8554)) {
    factors.push({ points: 10, reason: "RTSP video-streaming port exposed — typically has no built-in brute-force rate limiting" });
  }

  if (factors.length === 0) factors.push({ points: 0, reason: "No risk signals detected in the checks performed" });

  return finalize(factors);
}
