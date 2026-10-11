// Rich, printable HTML reports (opened in a new tab; Ctrl/Cmd+P → Save as
// PDF). All charts are inline SVG so they stay crisp when printed. No
// external requests, fonts, or images — everything renders standalone.

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

// ---------- shared visual primitives ----------

function riskGauge(score: number, size = 168): string {
  const r = size * 0.38;
  const stroke = size * 0.09;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - score / 100);
  const color = score >= 70 ? "#dc2626" : score >= 40 ? "#f59e0b" : "#10b981";
  const label = score >= 70 ? "HIGH RISK" : score >= 40 ? "MODERATE" : "LOW RISK";
  const cx = size / 2;
  return `
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="#efe9fb" stroke-width="${stroke}" />
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"
      transform="rotate(-90 ${cx} ${cx})" style="transition: stroke-dashoffset 1s;" />
    <text x="${cx}" y="${cx - 4}" text-anchor="middle" font-size="${size * 0.22}" font-weight="800" fill="#181229">${score}</text>
    <text x="${cx}" y="${cx + size * 0.15}" text-anchor="middle" font-size="${size * 0.065}" font-weight="700" letter-spacing="1" fill="${color}">${label}</text>
  </svg>`;
}

function scoreGauge(score: number, label: string, size = 130): string {
  const r = size * 0.38;
  const stroke = size * 0.1;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - score / 100);
  const color = score >= 80 ? "#10b981" : score >= 50 ? "#f59e0b" : "#dc2626";
  const cx = size / 2;
  return `
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="#efe9fb" stroke-width="${stroke}" />
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cx})" />
    <text x="${cx}" y="${cx - 2}" text-anchor="middle" font-size="${size * 0.24}" font-weight="800" fill="#181229">${score}</text>
    <text x="${cx}" y="${cx + size * 0.18}" text-anchor="middle" font-size="${size * 0.08}" fill="#666">${esc(label)}</text>
  </svg>`;
}

function barChart(items: { label: string; value: number; color?: string }[], maxOverride?: number): string {
  const max = maxOverride ?? Math.max(1, ...items.map((i) => i.value));
  const barH = 26, gap = 12, width = 460, labelW = 140, chartW = width - labelW - 55;
  const height = items.length * (barH + gap) + gap;
  const rows = items.map((item, i) => {
    const y = gap + i * (barH + gap);
    const w = Math.max(3, (item.value / max) * chartW);
    const color = item.color ?? "#9333EA";
    return `
      <text x="0" y="${y + barH / 2 + 4}" font-size="12" fill="#333" font-weight="600">${esc(item.label)}</text>
      <rect x="${labelW}" y="${y}" width="${chartW}" height="${barH}" fill="#f4f1fa" rx="5" />
      <rect x="${labelW}" y="${y}" width="${w}" height="${barH}" fill="${color}" rx="5" />
      <text x="${labelW + chartW + 10}" y="${y + barH / 2 + 4}" font-size="13" font-weight="700" fill="#181229">${item.value}</text>`;
  }).join("");
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rows}</svg>`;
}

function statBox(value: string | number, label: string, tone: "critical" | "warn" | "ok" | "neutral" = "neutral"): string {
  const colors = { critical: "#dc2626", warn: "#d97706", ok: "#059669", neutral: "#181229" };
  return `
  <div class="statbox">
    <div class="statbox-value" style="color:${colors[tone]}">${esc(String(value))}</div>
    <div class="statbox-label">${esc(label)}</div>
  </div>`;
}

function chip(text: string, tone: "critical" | "warn" | "ok" | "info" = "info"): string {
  return `<span class="chip chip-${tone}">${esc(text)}</span>`;
}

function section(icon: string, title: string, contentHtml: string): string {
  return `
  <section class="section">
    <h2><span class="section-icon">${icon}</span>${esc(title)}</h2>
    ${contentHtml}
  </section>`;
}

function card(html: string): string {
  return `<div class="card">${html}</div>`;
}

// ---------- shell ----------

function shell(reportType: string, target: string, riskScore: number, summary: string, bodyHtml: string): string {
  const generatedAt = new Date().toLocaleString();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Jaser Report — ${esc(target)}</title>
<style>
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; color: #181229; max-width: 900px; margin: 0 auto; background: #fbfaff; }
  .hero { background: linear-gradient(120deg, #1a1030 0%, #2a1245 55%, #4a1030 100%); color: #fff; padding: 40px 44px; display: flex; justify-content: space-between; align-items: center; gap: 24px; }
  .hero h1 { font-size: 13px; letter-spacing: 3px; text-transform: uppercase; color: #c9a6ff; margin: 0 0 10px; font-weight: 700; }
  .hero h2 { font-size: 26px; margin: 0 0 6px; font-weight: 800; }
  .hero .target { font-family: monospace; font-size: 15px; color: #f0c6d6; word-break: break-all; }
  .hero .meta { font-size: 11px; color: #a898c4; margin-top: 10px; }
  .body-pad { padding: 32px 44px 50px; }
  .summary-box { background: #fff; border: 1px solid #e5deef; border-left: 5px solid #9333EA; border-radius: 10px; padding: 18px 22px; margin-bottom: 24px; font-size: 14px; line-height: 1.6; }
  .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 8px; }
  .statbox { background: #fff; border: 1px solid #e5deef; border-radius: 10px; padding: 14px; text-align: center; }
  .statbox-value { font-size: 24px; font-weight: 800; }
  .statbox-label { font-size: 10.5px; color: #666; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }
  .section { margin-top: 30px; page-break-inside: avoid; }
  .section h2 { font-size: 16px; margin: 0 0 12px; display: flex; align-items: center; gap: 8px; color: #2a1245; border-bottom: 2px solid #efe9fb; padding-bottom: 8px; }
  .section-icon { font-size: 16px; }
  .card { background: #fff; border: 1px solid #e5deef; border-radius: 10px; padding: 16px 18px; margin-bottom: 12px; page-break-inside: avoid; }
  .chip { display: inline-block; font-size: 10.5px; font-weight: 700; padding: 3px 10px; border-radius: 20px; margin: 2px 4px 2px 0; letter-spacing: 0.3px; }
  .chip-critical { background: #fee2e2; color: #991b1b; }
  .chip-warn { background: #fef3c7; color: #92400e; }
  .chip-ok { background: #d1fae5; color: #065f46; }
  .chip-info { background: #ede9fe; color: #5b21b6; }
  ul.advice { padding-left: 0; list-style: none; margin: 0; }
  ul.advice li { margin-bottom: 8px; font-size: 13.5px; line-height: 1.5; padding-left: 22px; position: relative; }
  ul.advice li::before { content: "›"; position: absolute; left: 0; color: #9333EA; font-weight: 900; font-size: 16px; }
  code { background: #f4f1fa; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td, th { text-align: left; padding: 7px 8px; border-bottom: 1px solid #f0edf7; }
  th { color: #666; font-weight: 600; font-size: 11px; text-transform: uppercase; }
  .print-btn { position: fixed; top: 18px; right: 18px; background: #9333EA; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; box-shadow: 0 4px 14px rgba(147,51,234,0.4); z-index: 10; }
  .print-btn:hover { background: #7e22ce; }
  @media print { .print-btn { display: none; } body { background: white; } }
  .footer { margin-top: 40px; border-top: 1px solid #e5deef; padding-top: 16px; font-size: 11px; color: #888; line-height: 1.6; }
  .mono { font-family: monospace; }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">📄 Print / Save as PDF</button>
  <div class="hero">
    <div>
      <h1>JASER · ${esc(reportType)}</h1>
      <h2>Investigation Report</h2>
      <div class="target">${esc(target)}</div>
      <div class="meta">Generated ${esc(generatedAt)}</div>
    </div>
    <div style="text-align:center;">
      ${riskGauge(riskScore)}
    </div>
  </div>
  <div class="body-pad">
    <div class="summary-box"><strong>Executive Summary:</strong> ${summary}</div>
    ${bodyHtml}
    <div class="footer">
      Generated locally by Jaser from live lookups at the time above, using free/keyless
      public sources (DNS, RDAP, TLS handshake, Shodan InternetDB, CIRCL, ip-api.com, crt.sh).
      This reflects point-in-time public data — re-run the scan before acting on stale findings.
      The risk score is a heuristic weighting of the signals below, not a certified security audit.
    </div>
  </div>
</body>
</html>`;
}

export function openReport(html: string) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
}

// ---------- Domain report ----------
export function buildDomainReport(target: string, data: any): string {
  const hasSpf = Boolean(data.security?.spf);
  const hasDmarc = Boolean(data.security?.dmarc);
  const sslOk = data.ssl?.status === "ok";
  const sslExpiringSoon = sslOk && data.ssl.data.daysUntilExpiry < 30;
  const whoisOk = data.whois?.status === "ok";

  let risk = 0;
  if (!hasSpf) risk += 20;
  if (!hasDmarc) risk += 20;
  if (!sslOk) risk += 25;
  if (sslExpiringSoon) risk += 15;
  risk = Math.min(100, risk);

  const summary = `This domain ${hasSpf && hasDmarc ? "has baseline email-spoofing protections in place" : "is missing email-spoofing protections (SPF/DMARC)"}, and its TLS certificate is ${sslOk ? (sslExpiringSoon ? "valid but expiring soon" : "valid") : "not verifiable"}. ${risk >= 40 ? "Address the flagged items below before treating this domain as low-risk." : "No urgent issues were found in the checks below."}`;

  const stats = `<div class="stat-grid">
    ${statBox(hasSpf ? "Present" : "Missing", "SPF Record", hasSpf ? "ok" : "critical")}
    ${statBox(hasDmarc ? "Present" : "Missing", "DMARC Record", hasDmarc ? "ok" : "critical")}
    ${statBox(sslOk ? `${data.ssl.data.daysUntilExpiry}d` : "N/A", "TLS Expires In", sslExpiringSoon ? "warn" : sslOk ? "ok" : "critical")}
    ${statBox(whoisOk ? "Known" : "Unknown", "Registration", whoisOk ? "ok" : "neutral")}
  </div>`;

  const body = stats + section("🌐", "DNS Overview", card(`
    <table>
      <tr><th>A</th><td class="mono">${esc(data.dns?.a?.join(", ") || "—")}</td></tr>
      <tr><th>MX</th><td class="mono">${esc((data.dns?.mx ?? []).map((m: any) => m.exchange).join(", ") || "—")}</td></tr>
      <tr><th>NS</th><td class="mono">${esc(data.dns?.ns?.join(", ") || "—")}</td></tr>
    </table>`))
    + section("✉️", "Email Security", card(`
      <p>${chip(hasSpf ? "SPF present" : "SPF missing", hasSpf ? "ok" : "critical")}${chip(hasDmarc ? "DMARC present" : "DMARC missing", hasDmarc ? "ok" : "critical")}</p>
      <p class="mono" style="font-size:12px; word-break:break-all; color:#555;">${esc(data.security?.spf ?? "no SPF record found")}</p>
      <p class="mono" style="font-size:12px; word-break:break-all; color:#555;">${esc(data.security?.dmarc ?? "no DMARC record found")}</p>`))
    + section("🔒", "TLS Certificate", card(
      sslOk
        ? `<p>Issued by <strong>${esc(data.ssl.data.issuer)}</strong> · Expires ${esc(new Date(data.ssl.data.validTo).toLocaleDateString())} (${data.ssl.data.daysUntilExpiry} days) ${sslExpiringSoon ? chip("Renew soon", "warn") : chip("Healthy", "ok")}</p>`
        : `<p>${chip("Could not establish a TLS handshake", "critical")}</p>`))
    + section("📇", "WHOIS / Registration", card(
      whoisOk
        ? `<p>Registrar: <strong>${esc(data.whois.data.registrar ?? "Unknown")}</strong> · Created: ${esc(data.whois.data.createdDate ?? "Unknown")}</p>`
        : `<p>No registration data available for this TLD via RDAP.</p>`))
    + section("🔏", "DNSSEC & CAA", card(`
      <p>${data.dnssec?.status === "ok" ? chip(data.dnssec.data.signed ? (data.dnssec.data.validated ? "DNSSEC validated" : "DNSSEC signed, unvalidated") : "Not signed", data.dnssec.data.validated ? "ok" : data.dnssec.data.signed ? "warn" : "info") : chip("Unknown", "info")}</p>
      ${data.caa?.status === "ok" ? `<table>${data.caa.data.records.map((r: any) => `<tr><th>${esc(r.tag)}</th><td class="mono">${esc(r.value)}</td></tr>`).join("")}</table>` : "<p>No CAA records found — any CA can issue certificates for this domain.</p>"}`))
    + (data.subdomains?.status === "ok" && data.subdomains.data.items.length > 0
        ? section("🗂️", `Subdomains (${data.subdomains.data.count} found via crt.sh)`, card(`<p class="mono" style="font-size:12px; word-break:break-all;">${data.subdomains.data.items.map(esc).join(", ")}</p>`))
        : "")
    + section("✅", "Recommendations", card(`<ul class="advice">
        ${!hasSpf ? "<li>Add an SPF record to prevent email spoofing of this domain.</li>" : ""}
        ${!hasDmarc ? "<li>Add a DMARC record — start with <code>p=none</code> for monitoring, then move to <code>p=reject</code> once confident.</li>" : ""}
        ${sslExpiringSoon ? "<li>TLS certificate expires within 30 days — renew before it lapses to avoid browser warnings.</li>" : ""}
        ${!sslOk ? "<li>Investigate why a TLS handshake could not be established on port 443.</li>" : ""}
        ${data.caa?.status === "not_found" ? "<li>Consider adding a CAA record to restrict which Certificate Authorities may issue TLS certs for this domain.</li>" : ""}
        <li>Re-run this scan periodically — DNS, certificates, and registration data change over time.</li>
      </ul>`));

  return shell("Domain & Security Records Scan", target, risk, summary, body);
}

// ---------- IP report ----------
export function buildIpReport(target: string, data: any): string {
  const ports: number[] = data.internetdb?.status === "ok" ? data.internetdb.data.ports : [];
  const vulns: string[] = data.internetdb?.status === "ok" ? data.internetdb.data.vulns : [];
  const geo = data.geo?.status === "ok" ? data.geo.data : null;
  const isTor = data.tor?.status === "ok" && data.tor.data.isTorExitNode;

  let risk = Math.min(60, vulns.length * 20) + Math.min(20, ports.length * 3) + (isTor ? 20 : 0);
  risk = Math.min(100, risk);

  const summary = `This host has ${ports.length} open port${ports.length === 1 ? "" : "s"} on record${vulns.length ? ` and ${vulns.length} known CVE${vulns.length === 1 ? "" : "s"}` : ""}. ${vulns.length ? "Patch the flagged software before this is treated as safe to expose." : "No known CVEs are on file for this host at the moment."}`;

  const body = `<div class="stat-grid">
      ${statBox(ports.length, "Open Ports", ports.length > 5 ? "warn" : "neutral")}
      ${statBox(vulns.length, "Known CVEs", vulns.length ? "critical" : "ok")}
      ${statBox(geo?.country ?? "?", "Location", "neutral")}
      ${statBox(isTor ? "Yes" : "No", "Tor Exit Node", isTor ? "critical" : "ok")}
    </div>`
    + section("📡", "Exposure Overview", card(barChart([{ label: "Open ports", value: ports.length, color: "#9333EA" }, { label: "Known CVEs", value: vulns.length, color: "#dc2626" }])))
    + section("🔌", "Open Ports", card(ports.length ? ports.map((p) => chip(String(p), "info")).join("") : "<p>None on record.</p>"))
    + (vulns.length ? section("🚨", "Known Vulnerabilities", card(`<ul class="advice">${vulns.map((v) => `<li>${chip("CVE", "critical")} <span class="mono">${esc(v)}</span></li>`).join("")}</ul>`)) : "")
    + section("🌍", "Network Context", card(
      geo
        ? `<p>${esc(geo.isp ?? "Unknown ISP")} · ${esc(geo.country ?? "Unknown")}</p><p>${geo.isProxy ? chip("Proxy", "warn") : ""}${geo.isHosting ? chip("Hosting/Datacenter", "warn") : ""}${isTor ? chip("Tor Exit Node", "critical") : ""}</p>`
        : "<p>No geolocation data available.</p>"))
    + section("🛰️", "ASN / Network Ownership", card(
      data.asn?.status === "ok"
        ? `<p>AS${esc(String(data.asn.data.asn ?? "?"))} <strong>${esc(data.asn.data.holder ?? "Unknown holder")}</strong>${data.asn.data.prefix ? ` · <span class="mono">${esc(data.asn.data.prefix)}</span>` : ""}${data.asn.data.countryCode ? ` · ${esc(data.asn.data.countryCode)}` : ""}</p>`
        : "<p>No ASN/routing data available.</p>")
      + (data.rdap?.status === "ok"
        ? `<p>RDAP: ${esc(data.rdap.data.org ?? data.rdap.data.name ?? "Unknown registrant")}${data.rdap.data.cidr ? ` · <span class="mono">${esc(data.rdap.data.cidr)}</span>` : ""}</p>`
        : ""))
    + section("✅", "Recommendations", card(`<ul class="advice">
        ${vulns.length ? "<li>Patch/update the software behind this host — known CVEs are listed above.</li>" : ""}
        ${ports.length > 3 ? "<li>Review whether every open port is actually needed; close anything not in active use.</li>" : ""}
        <li>If this host isn't meant to be internet-facing, put it behind a firewall/VPN instead.</li>
      </ul>`));

  return shell("IP / ASN Analysis", target, risk, summary, body);
}

// ---------- Web App report ----------
export function buildWebAppReport(target: string, data: any): string {
  const grade = data.headerScan?.grade ?? "?";
  const score = data.headerScan?.score ?? 0;
  const checks = data.headerScan?.checks ?? [];
  const subdomains: string[] = data.subdomains?.list ?? [];
  const owasp = data.owasp ?? null;

  const missingCritical = checks.filter((c: any) => !c.present && c.severity === "critical").length;
  const exposedFiles = owasp?.exposedFiles?.filter((f: any) => f.exposed) ?? [];
  const risk = Math.min(100, missingCritical * 25 + exposedFiles.length * 20 + (owasp?.weakTls ? 20 : 0));

  const summary = `Security header grade is <strong>${grade}</strong> (${score}/100)${exposedFiles.length ? `, and ${exposedFiles.length} normally-sensitive file path${exposedFiles.length === 1 ? "" : "s"} appear reachable` : ""}. ${subdomains.length} subdomain${subdomains.length === 1 ? "" : "s"} found via public certificate logs. ${risk >= 40 ? "Review the flagged items below." : "No urgent issues found in the passive checks performed."}`;

  const body = `<div class="stat-grid">
      ${statBox(grade, "Header Grade", score >= 70 ? "ok" : score >= 40 ? "warn" : "critical")}
      ${statBox(subdomains.length, "Subdomains Found", "neutral")}
      ${statBox(exposedFiles.length, "Exposed Paths", exposedFiles.length ? "critical" : "ok")}
      ${statBox(owasp?.weakTls ? "Weak" : "OK", "TLS Protocol", owasp?.weakTls ? "critical" : "ok")}
    </div>`
    + section("🛡️", "Security Header Grade", `<div class="card" style="display:flex; align-items:center; gap:28px; flex-wrap:wrap;">
        ${scoreGauge(score, `Grade ${grade}`)}
        <table style="flex:1; min-width:220px;">
          ${checks.map((c: any) => `<tr><td>${c.present ? "✅" : "❌"} ${esc(c.header)}</td></tr>`).join("")}
        </table>
      </div>`)
    + section("⚠️", "Missing Headers — Why It Matters", card(`<ul class="advice">
        ${checks.filter((c: any) => !c.present).map((c: any) => `<li>${chip(c.header, c.severity === "critical" ? "critical" : "warn")} ${esc(c.note)}</li>`).join("") || "All checked headers are present."}
      </ul>`))
    + (owasp ? section("🧪", "OWASP Top 10 — Passive Coverage", card(`
        <table>
          <tr><td>${owasp.weakTls ? "❌" : "✅"} Cryptographic Failures (weak TLS protocol)</td></tr>
          <tr><td>${checks.every((c: any) => c.present) ? "✅" : "⚠️"} Security Misconfiguration (headers)</td></tr>
          <tr><td>${exposedFiles.length ? "❌" : "✅"} Security Misconfiguration (exposed sensitive files)</td></tr>
          <tr><td>${owasp.serverVersionDisclosed ? "⚠️" : "✅"} Vulnerable/Outdated Components (version disclosure)</td></tr>
          <tr><td>${owasp.missingSri ? "⚠️" : "✅"} Software/Data Integrity (missing Subresource Integrity)</td></tr>
        </table>
        <p style="font-size:11.5px; color:#888; margin-top:10px;">Injection, Broken Access Control, SSRF, and Auth Failures require sending active test
        payloads to confirm — not performed here by design; see the tool's notes for why.</p>
      `)) : "")
    + (exposedFiles.length ? section("📂", "Exposed Sensitive Paths", card(`<ul class="advice">${exposedFiles.map((f: any) => `<li>${chip("Exposed", "critical")} <code>${esc(f.path)}</code> (HTTP ${f.status})</li>`).join("")}</ul>`)) : "")
    + section("🕸️", `Subdomains (${subdomains.length})`, card(subdomains.length ? `<p class="mono" style="font-size:12px; line-height:1.9;">${subdomains.map(esc).join(" · ")}</p>` : "<p>None found in Certificate Transparency logs.</p>"));

  return shell("Web App Security Scan", target, risk, summary, body);
}

// ---------- Camera report ----------
export function buildCameraReport(target: string, ports: number[], vulns: string[], isLikelyCamera: boolean, vendorGuess: string | null, advice: string[]): string {
  const risk = Math.min(100, vulns.length * 30 + (isLikelyCamera ? 15 : 0) + Math.min(20, ports.length * 4));
  const summary = `${isLikelyCamera ? `This device fingerprints as a camera/DVR${vendorGuess ? ` (likely ${vendorGuess})` : ""}` : "No camera/DVR fingerprint was detected"}, with ${ports.length} open port${ports.length === 1 ? "" : "s"}${vulns.length ? ` and ${vulns.length} known CVE${vulns.length === 1 ? "" : "s"}` : ""}. ${vulns.length ? "Treat firmware patching as priority #1." : "Follow the general hardening checklist below regardless."}`;

  const body = `<div class="stat-grid">
      ${statBox(isLikelyCamera ? "Yes" : "No", "Camera Fingerprint", isLikelyCamera ? "warn" : "ok")}
      ${statBox(ports.length, "Open Ports", "neutral")}
      ${statBox(vulns.length, "Known CVEs", vulns.length ? "critical" : "ok")}
      ${statBox(vendorGuess ?? "Unknown", "Likely Vendor", "neutral")}
    </div>`
    + section("📡", "Exposure Overview", card(barChart([{ label: "Open ports", value: ports.length, color: "#9333EA" }, { label: "Known CVEs", value: vulns.length, color: "#dc2626" }])))
    + section("🔌", "Open Ports", card(ports.length ? ports.map((p) => chip(String(p), "info")).join("") : "<p>None on record.</p>"))
    + (vulns.length ? section("🚨", "Known Vulnerabilities", card(`<ul class="advice">${vulns.map((v) => `<li>${chip("CVE", "critical")} <span class="mono">${esc(v)}</span></li>`).join("")}</ul>`)) : "")
    + section("✅", "Remediation Checklist", card(`<ul class="advice">${advice.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>`));

  return shell("CCTV / IoT Camera Check", target, risk, summary, body);
}

// ---------- File / Malware Inspector report ----------
type FileVerdict = { id: string; title: string; severity: "danger" | "warning" | "info" | "safe"; summary: string; explanation: string; recommendation: string };

const VERDICT_TONE: Record<FileVerdict["severity"], "critical" | "warn" | "info" | "ok"> = {
  danger: "critical",
  warning: "warn",
  info: "info",
  safe: "ok",
};
const VERDICT_COLOR: Record<FileVerdict["severity"], string> = {
  danger: "#dc2626",
  warning: "#f59e0b",
  info: "#0891b2",
  safe: "#10b981",
};

export function buildFileReport(input: {
  fileName: string;
  fileSize: number;
  sha256: string;
  sha1: string;
  sha512: string;
  mimeType: string;
  typeLabel: string;
  entropy: number;
  hasMacros: boolean | null;
  macroNote: string;
  verdicts: FileVerdict[];
  overallSeverity: FileVerdict["severity"];
  circlStatus: "ok" | "not_found" | "error" | null;
  circlName?: string | null;
  interestingStrings: string[];
  pdfMeta: Record<string, string> | null;
  exif: Record<string, unknown> | null;
}): string {
  const { fileName, fileSize, sha256, sha1, sha512, mimeType, typeLabel, entropy, hasMacros, macroNote, verdicts, overallSeverity, circlStatus, circlName, interestingStrings, pdfMeta, exif } = input;

  const counts = { danger: 0, warning: 0, info: 0, safe: 0 };
  for (const v of verdicts) counts[v.severity]++;

  const riskMap: Record<FileVerdict["severity"], number> = { danger: 88, warning: 55, info: 22, safe: 6 };
  const risk = riskMap[overallSeverity];

  const overallText = {
    danger: "This file has real red flags — treat it as unsafe until proven otherwise.",
    warning: "This file has findings worth reviewing before you trust it.",
    info: "Nothing dangerous found, but a few points are worth noting.",
    safe: "No red flags found in any of the checks performed.",
  }[overallSeverity];

  const summary = `Static analysis of <strong>${esc(fileName)}</strong> (${typeLabel}) found ${verdicts.length} finding${verdicts.length === 1 ? "" : "s"} — ${counts.danger} danger, ${counts.warning} warning. ${overallText}`;

  const body = `<div class="stat-grid">
      ${statBox(typeLabel, "Detected Type", "neutral")}
      ${statBox(entropy.toFixed(2), "Entropy / 8", entropy > 7.2 ? "warn" : "ok")}
      ${statBox(verdicts.length, "Findings", verdicts.length ? "warn" : "ok")}
      ${statBox(circlStatus === "ok" ? "Known-good" : circlStatus === "not_found" ? "Unverified" : "Unchecked", "CIRCL Match", circlStatus === "ok" ? "ok" : "neutral")}
    </div>`
    + section("🧭", "Finding Breakdown", card(barChart([
      { label: "Danger", value: counts.danger, color: VERDICT_COLOR.danger },
      { label: "Warning", value: counts.warning, color: VERDICT_COLOR.warning },
      { label: "Info", value: counts.info, color: VERDICT_COLOR.info },
      { label: "Safe / OK", value: counts.safe, color: VERDICT_COLOR.safe },
    ])))
    + section("🔎", "Detailed Findings", verdicts.length
        ? verdicts.map((v) => card(`
            <p>${chip(v.severity.toUpperCase(), VERDICT_TONE[v.severity])} <strong>${esc(v.title)}</strong></p>
            <p style="font-size:13px; margin:6px 0;">${esc(v.summary)}</p>
            <p style="font-size:12px; color:#666; margin:4px 0;"><strong>Why it matters:</strong> ${esc(v.explanation)}</p>
            <p style="font-size:12px; color:#555;"><strong>Recommended:</strong> ${esc(v.recommendation)}</p>
          `)).join("")
        : card("<p>No findings — every check came back clean.</p>"))
    + section("🧬", "Hashes & Metadata", card(`
        <table>
          <tr><th>File</th><td>${esc(fileName)} (${(fileSize / 1024).toFixed(1)} KB)</td></tr>
          <tr><th>MIME</th><td>${esc(mimeType)}</td></tr>
          <tr><th>SHA-256</th><td class="mono" style="word-break:break-all;">${esc(sha256)}</td></tr>
          <tr><th>SHA-1</th><td class="mono" style="word-break:break-all;">${esc(sha1)}</td></tr>
          <tr><th>SHA-512</th><td class="mono" style="word-break:break-all; font-size:10px;">${esc(sha512)}</td></tr>
        </table>`))
    + section("📜", "Macro Check", card(`<p>${hasMacros === true ? chip("Macros present", "critical") : hasMacros === false ? chip("No macros", "ok") : chip("Not applicable", "info")} ${esc(macroNote)}</p>`))
    + (interestingStrings.length ? section("🚩", `Flagged Strings (${interestingStrings.length})`, card(`<p class="mono" style="font-size:11.5px; word-break:break-all; line-height:1.8;">${interestingStrings.map(esc).join("<br/>")}</p>`)) : "")
    + (pdfMeta && Object.keys(pdfMeta).length ? section("📄", "PDF Metadata", card(`<table>${Object.entries(pdfMeta).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`)) : "")
    + (exif && Object.keys(exif).length ? section("🖼️", "EXIF Metadata", card(`<table>${Object.entries(exif).slice(0, 20).map(([k, v]) => `<tr><th>${esc(k)}</th><td class="mono">${esc(String(v))}</td></tr>`).join("")}</table>`)) : "")
    + section("✅", "Recommendations", card(`<ul class="advice">
        ${verdicts.filter((v) => v.severity === "danger" || v.severity === "warning").map((v) => `<li>${esc(v.recommendation)}</li>`).join("") || "<li>No specific remediation needed based on this static scan.</li>"}
        <li>This is static/heuristic triage — it does not execute the file. For real behavioral confirmation, use a proper sandbox (Any.Run, Joe Sandbox, Hybrid Analysis).</li>
      </ul>`));

  return shell("File / Malware Inspector", fileName, risk, summary, body);
}

// ---------- Email OSINT report ----------
export function buildEmailReport(target: string, data: {
  gravatar: { status: string; data?: { avatarUrl: string; displayName: string | null; profileUrl: string | null } };
  breaches: { status: string; data?: { items: { name: string; domain: string | null; breachDate: string | null; dataClasses: string[] }[]; source: string } };
}): string {
  const hasGravatar = data.gravatar.status === "ok";
  const breachItems = data.breaches.status === "ok" ? data.breaches.data!.items : [];
  const risk = Math.min(100, breachItems.length === 0 ? 5 : 25 + breachItems.length * 12);

  const summary = `${breachItems.length > 0 ? `This address appears in <strong>${breachItems.length}</strong> known breach${breachItems.length === 1 ? "" : "es"}` : "No known breaches found for this address"}${hasGravatar ? ", and has a public Gravatar profile" : ""}. ${breachItems.length ? "Treat any password reused across these services as compromised." : "Still good practice to use unique passwords and enable 2FA everywhere."}`;

  const body = `<div class="stat-grid">
      ${statBox(breachItems.length, "Known Breaches", breachItems.length ? "critical" : "ok")}
      ${statBox(hasGravatar ? "Yes" : "No", "Public Gravatar", hasGravatar ? "warn" : "ok")}
      ${statBox(data.breaches.status === "ok" ? data.breaches.data!.source : "—", "Source", "neutral")}
      ${statBox(new Set(breachItems.flatMap((b) => b.dataClasses)).size, "Exposed Data Types", "neutral")}
    </div>`
    + (hasGravatar ? section("👤", "Public Profile", card(`<p>Display name: <strong>${esc(data.gravatar.data!.displayName ?? "—")}</strong></p>${data.gravatar.data!.profileUrl ? `<p class="mono" style="font-size:12px;">${esc(data.gravatar.data!.profileUrl)}</p>` : ""}`)) : section("👤", "Public Profile", card("<p>No public Gravatar profile registered to this address.</p>")))
    + section("🕳️", `Known Breaches (${breachItems.length})`, breachItems.length
        ? card(`<table><tr><th>Breach</th><th>Domain</th><th>Date</th><th>Exposed Data</th></tr>${breachItems.map((b) => `<tr><td>${esc(b.name)}</td><td class="mono">${esc(b.domain ?? "—")}</td><td>${esc(b.breachDate ?? "—")}</td><td>${b.dataClasses.map((d) => chip(d, "warn")).join("") || "—"}</td></tr>`).join("")}</table>`)
        : card("<p>This address wasn't found in any breach database checked.</p>"))
    + section("✅", "Recommendations", card(`<ul class="advice">
        ${breachItems.length ? "<li>Change the password on every service listed above, and anywhere else it was reused.</li><li>Enable two-factor authentication on all important accounts tied to this address.</li>" : "<li>Keep using unique passwords per service and a password manager.</li>"}
        <li>Watch for phishing that references real breach details to appear credible.</li>
      </ul>`));

  return shell("Email OSINT — Accounts & Breach Exposure", target, risk, summary, body);
}

// ---------- WiFi geolocation reports ----------
export function buildWifiReport(bssid: string, location: { lat: number; lon: number; rangeMeters: number | null }): string {
  const summary = `This BSSID was located at approximately <strong>${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}</strong>${location.rangeMeters ? `, with an estimated accuracy radius of ${location.rangeMeters}m` : ""}. This is a crowdsourced wardriving database position, not a live tracker — treat it as historical, approximate evidence.`;

  const body = `<div class="stat-grid">
      ${statBox(location.lat.toFixed(5), "Latitude", "neutral")}
      ${statBox(location.lon.toFixed(5), "Longitude", "neutral")}
      ${statBox(location.rangeMeters ? `${location.rangeMeters}m` : "Unknown", "Accuracy", "neutral")}
      ${statBox("WiGLE / Mylnikov", "Source", "neutral")}
    </div>`
    + section("📍", "Location", card(`<p><a href="https://www.google.com/maps?q=${location.lat},${location.lon}" target="_blank">Open in Google Maps</a></p>`))
    + section("✅", "Notes", card(`<ul class="advice">
        <li>Coverage comes from crowdsourced wardriving contributions — accuracy varies with how densely an area has been scanned.</li>
        <li>A BSSID's position can be stale if the access point has physically moved since it was last observed.</li>
      </ul>`));

  return shell("WiFi Geolocation (BSSID)", bssid, 10, summary, body);
}

export function buildWifiSsidReport(ssid: string, items: { bssid: string; lat: number; lon: number; encryption: string | null; channel: number | null }[]): string {
  const summary = `Found <strong>${items.length}</strong> access point${items.length === 1 ? "" : "s"} broadcasting the network name "<strong>${esc(ssid)}</strong>" in the WiGLE wardriving database. Multiple results usually mean either a chain/franchise using the same default SSID, or several access points on one real network.`;

  const body = `<div class="stat-grid">
      ${statBox(items.length, "Access Points Found", "neutral")}
      ${statBox(new Set(items.map((i) => i.encryption ?? "unknown")).size, "Encryption Types Seen", "neutral")}
      ${statBox("WiGLE", "Source", "neutral")}
      ${statBox("—", "", "neutral")}
    </div>`
    + section("📡", "Matches", card(`<table><tr><th>BSSID</th><th>Location</th><th>Encryption</th><th>Channel</th></tr>${items.map((i) => `<tr><td class="mono">${esc(i.bssid)}</td><td><a href="https://www.google.com/maps?q=${i.lat},${i.lon}" target="_blank">${i.lat.toFixed(4)}, ${i.lon.toFixed(4)}</a></td><td>${esc(i.encryption ?? "unknown")}</td><td>${i.channel ?? "—"}</td></tr>`).join("")}</table>`))
    + section("✅", "Notes", card(`<ul class="advice">
        <li>Coverage comes from crowdsourced wardriving contributions — not every real-world access point will appear here.</li>
        <li>If several results cluster in one place, that's likely one physical location with multiple access points.</li>
      </ul>`));

  return shell("WiFi Geolocation (SSID Search)", ssid, 10, summary, body);
}

// ---------- Username / Name / Phone OSINT report ----------
export function buildUsernameReport(target: string, mode: string, results: { platform: string; url: string; status: "found" | "not_found" | "unknown"; confidence: "reliable" | "heuristic"; note?: string }[]): string {
  const found = results.filter((r) => r.status === "found");
  const unknown = results.filter((r) => r.status === "unknown");
  const footprint = Math.round((found.length / Math.max(1, results.length)) * 100);

  const summary = `Checked <strong>${results.length}</strong> platform${results.length === 1 ? "" : "s"} for "<strong>${esc(target)}</strong>" — <strong>${found.length}</strong> confirmed match${found.length === 1 ? "" : "es"}${unknown.length ? `, ${unknown.length} unverified (bot-walled platforms)` : ""}. A confirmed match means a public profile page exists there, not that it's proven to be the same person behind every account.`;

  const body = `<div class="stat-grid">
      ${statBox(found.length, "Confirmed Matches", found.length ? "warn" : "ok")}
      ${statBox(unknown.length, "Unverified", "neutral")}
      ${statBox(results.length - found.length - unknown.length, "Not Found", "ok")}
      ${statBox(`${footprint}%`, "Footprint Score", footprint > 40 ? "warn" : "ok")}
    </div>`
    + (found.length ? section("✅", "Confirmed Profiles", card(`<ul class="advice">${found.map((r) => `<li><strong>${esc(r.platform)}</strong>${r.url ? ` — <a href="${esc(r.url)}" target="_blank">${esc(r.url)}</a>` : ""}${r.note ? ` — ${esc(r.note)}` : ""}</li>`).join("")}</ul>`)) : "")
    + (unknown.length ? section("❔", "Worth Checking Manually", card(`<ul class="advice">${unknown.map((r) => `<li><strong>${esc(r.platform)}</strong>${r.url ? ` — <a href="${esc(r.url)}" target="_blank">${esc(r.url)}</a>` : ""}</li>`).join("")}</ul>`)) : "")
    + section("✅", "Notes", card(`<ul class="advice">
        <li>Green/confirmed results are real checks; amber/unverified platforms block automated checks and need a manual look.</li>
        <li>A shared handle across platforms is a lead, not proof of identity — corroborate before acting on it.</li>
      </ul>`));

  return shell(`${mode === "username" ? "Username" : mode === "name" ? "Name / Company" : "Phone"} OSINT`, target, footprint, summary, body);
}

// ---------- Image Threat Intelligence report ----------

export function buildImageIntelReport(inv: import("./imageIntel/types").ImageInvestigation): string {
  const body: string[] = [];

  body.push(section("🖼️", "Image Identification", card(`
    <table>
      <tr><th>File name</th><td class="mono">${esc(inv.image.fileName)}</td></tr>
      <tr><th>Size</th><td>${(inv.image.fileSizeBytes / 1024).toFixed(1)} KB</td></tr>
      <tr><th>Dimensions</th><td>${inv.image.width} × ${inv.image.height}</td></tr>
      <tr><th>Detected format</th><td>${esc(inv.image.detectedFormat ?? "unknown")}</td></tr>
      <tr><th>Extension mismatch</th><td>${inv.image.extensionMismatch ? '<span class="chip chip-warn">YES</span>' : '<span class="chip chip-ok">no</span>'}</td></tr>
      <tr><th>SHA-256</th><td class="mono">${esc(inv.image.sha256)}</td></tr>
      <tr><th>SHA-1</th><td class="mono">${esc(inv.image.sha1)}</td></tr>
      <tr><th>MD5</th><td class="mono">${esc(inv.image.md5)}</td></tr>
    </table>`)));

  body.push(section("🔍", "Perceptual Fingerprints", card(`
    <table>
      <tr><th>aHash</th><td class="mono">${esc(inv.fingerprints.aHash)}</td></tr>
      <tr><th>dHash</th><td class="mono">${esc(inv.fingerprints.dHash)}</td></tr>
      <tr><th>pHash</th><td class="mono">${esc(inv.fingerprints.pHash)}</td></tr>
    </table>`)));

  const metaRows = inv.metadata.fields.slice(0, 40).map((f) => `<tr><th>${esc(f.key)}</th><td class="mono">${esc(f.value)}</td></tr>`).join("");
  body.push(section("📋", "Metadata", card(`
    <p><strong>Status:</strong> <span class="chip ${inv.metadata.status === "found" ? "chip-ok" : inv.metadata.status === "inconsistent" ? "chip-warn" : "chip-info"}">${inv.metadata.status.toUpperCase()}</span></p>
    ${inv.metadata.inconsistencyNotes.length > 0 ? `<ul class="advice">${inv.metadata.inconsistencyNotes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    ${inv.metadata.gps ? `<p><strong>EXIF GPS (embedded, not inferred):</strong> ${inv.metadata.gps.latitude}, ${inv.metadata.gps.longitude}</p>` : `<p>No EXIF GPS coordinates found.</p>`}
    ${metaRows ? `<table>${metaRows}</table>` : "<p>No metadata fields extracted.</p>"}`)));

  const forensicCards = inv.forensicFindings.map((f) => card(`
    <p><strong>${esc(f.title)}</strong> <span class="chip ${f.severity === "significant" ? "chip-warn" : "chip-info"}">${f.severity.toUpperCase()} · confidence: ${f.confidence}</span></p>
    <p>${esc(f.explanation)}</p>`)).join("");
  body.push(section("🧪", "Forensic Findings", forensicCards || card("<p>No forensic findings — this is informational, not a guarantee of authenticity.</p>")));

  if (inv.ela) {
    body.push(section("🔬", "Error Level Analysis (ELA)", card(`
      <p><strong>${esc(inv.ela.headline)}</strong></p>
      <p>${esc(inv.ela.explanation)}</p>`)));
  }

  if (inv.ocr) {
    body.push(section("🔤", "OCR Findings", card(`
      <p><strong>Mean confidence:</strong> ${inv.ocr.meanConfidence.toFixed(1)}%</p>
      <p><strong>Extracted text:</strong></p>
      <p class="mono" style="white-space:pre-wrap;">${esc(inv.ocr.rawText || "(no text detected)")}</p>
      ${inv.ocr.urls.length ? `<p><strong>URLs:</strong> ${inv.ocr.urls.map(esc).join(", ")}</p>` : ""}
      ${inv.ocr.usernames.length ? `<p><strong>Usernames:</strong> ${inv.ocr.usernames.map(esc).join(", ")}</p>` : ""}
      ${inv.ocr.domains.length ? `<p><strong>Domains:</strong> ${inv.ocr.domains.map(esc).join(", ")}</p>` : ""}
      ${inv.ocr.hashtags.length ? `<p><strong>Hashtags:</strong> ${inv.ocr.hashtags.map(esc).join(", ")}</p>` : ""}`)));
  }

  if (inv.faces.length > 0) {
    body.push(section("🙂", "Face Analysis (quality only — no identity inference)", card(`
      <p>${inv.faces.length} face(s) detected.</p>
      <table><tr><th>#</th><th>Quality</th><th>Resolution</th><th>Pose</th></tr>
      ${inv.faces.map((f, i) => `<tr><td>${i + 1}</td><td>${f.qualityScore}/100</td><td>${f.resolutionPx.toLocaleString()}px</td><td>${f.estimatedYaw}</td></tr>`).join("")}
      </table>`)));
  }

  if (inv.objects.length > 0) {
    body.push(section("📦", "Object Detection (COCO-SSD, 80-class)", card(`
      <table><tr><th>Class</th><th>Confidence</th></tr>
      ${inv.objects.map((o) => `<tr><td>${esc(o.className)}</td><td>${(o.confidence * 100).toFixed(0)}%</td></tr>`).join("")}
      </table>`)));
  }

  const providerRows = ([
    ["TinEye (reverse image search)", inv.reverseImageMatches],
    ["Reddit", inv.redditResults],
    ["X", inv.xResults],
  ] as [string, any][]).map(([label, state]) => {
    const status = state.status === "ok" ? `<span class="chip chip-ok">${state.data.length} result(s)</span>` :
      state.status === "missing_key" ? `<span class="chip chip-info">NOT CONFIGURED (${esc(state.envVar)})</span>` :
      state.status === "not_found" ? `<span class="chip chip-info">no results</span>` :
      state.status === "rate_limited" ? `<span class="chip chip-warn">rate limited</span>` :
      `<span class="chip chip-warn">error</span>`;
    return `<tr><th>${esc(label)}</th><td>${status}</td></tr>`;
  }).join("");
  body.push(section("🌐", "External Provider Status", card(`<table>${providerRows}</table>
    <p style="margin-top:10px;color:#888;font-size:12px;">No external provider ever receives this image or its derived text unless explicitly configured with real credentials — "not configured" is an honest state, not a failed search.</p>`)));

  if (inv.candidateComparison) {
    const cc = inv.candidateComparison;
    body.push(section("🔗", "Candidate Comparison", card(`
      <p><strong>Confidence:</strong> <span class="chip ${inv.confidence.level === "VERIFIED" || inv.confidence.level === "HIGH_CONFIDENCE" ? "chip-ok" : inv.confidence.level === "NOT_MATCHED" ? "chip-info" : "chip-warn"}">${inv.confidence.level.replace("_", " ")}</span></p>
      <p style="white-space:pre-wrap;">${esc(inv.confidence.explanation)}</p>
      ${cc.status === "ok" ? `<table>
        <tr><th>Keypoints (A / B)</th><td>${cc.keypointsA} / ${cc.keypointsB}</td></tr>
        <tr><th>Good matches</th><td>${cc.goodMatches}</td></tr>
        <tr><th>Geometric inliers</th><td>${cc.inlierCount} (${(cc.inlierRatio * 100).toFixed(0)}%)</td></tr>
        <tr><th>Geometrically consistent</th><td>${cc.geometricallyConsistent ? "yes" : "no"}</td></tr>
      </table>` : `<p>${esc(cc.message ?? "")}</p>`}`)));
  }

  if (inv.warnings.length > 0) {
    body.push(section("⚠️", "Limitations / Warnings", card(`<ul class="advice">${inv.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`)));
  }

  const summary = `Investigated ${esc(inv.image.fileName)} (${inv.mode} mode). ${inv.ocr ? `OCR extracted ${inv.ocr.normalizedText.length} characters of text. ` : ""}${inv.forensicFindings.length} forensic finding(s), ${inv.faces.length} face(s), ${inv.objects.length} object(s) detected. External provider searches: run only on explicit analyst action, never automatically.`;
  const score = inv.forensicFindings.some((f) => f.severity === "significant") ? 60 : inv.forensicFindings.length > 0 ? 30 : 10;

  return shell("Image Threat Intelligence", inv.image.fileName, score, summary, body.join(""));
}
