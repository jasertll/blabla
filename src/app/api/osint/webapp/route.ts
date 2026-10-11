import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet, TTL } from "@/lib/cache";
import { evaluateHeaders } from "@/lib/securityHeaders";
import { checkExposedFiles, checkVersionDisclosure, checkTlsProtocol, checkMissingSri, ExposedFileResult } from "@/lib/owaspChecks";
import { validateHostForOutboundRequest, safeFetch } from "@/lib/ssrfGuard";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import { extractHostname } from "@/lib/extractHostname";
import { analyzeCsp, type CspAnalysis } from "@/lib/cspAnalysis";
import { analyzeCookies, type CookieFinding } from "@/lib/cookieAnalysis";
import { checkCorsMisconfig, type CorsAnalysis } from "@/lib/corsAnalysis";

export const runtime = "nodejs";

type WebAppResult = {
  target: string;
  finalUrl: string | null;
  headerScan: {
    status: "ok" | "error";
    message?: string;
    grade?: string;
    score?: number;
    checks?: ReturnType<typeof evaluateHeaders>["checks"];
  };
  subdomains: {
    status: "ok" | "error" | "not_found";
    message?: string;
    list?: string[];
  };
  owasp: {
    weakTls: boolean;
    tlsProtocol: string | null;
    serverVersionDisclosed: boolean;
    versionHeaders: string[];
    exposedFiles: ExposedFileResult[];
    missingSri: boolean;
  } | null;
  csp: CspAnalysis | null;
  cookies: CookieFinding[];
  cors: CorsAnalysis | null;
};

async function scanHeaders(domain: string): Promise<
  WebAppResult["headerScan"] & {
    finalUrl: string | null;
    html: string | null;
    origin: string | null;
    versionInfo: { disclosed: boolean; values: string[] };
    csp: CspAnalysis;
    cookies: CookieFinding[];
  }
> {
  for (const scheme of ["https://", "http://"]) {
    try {
      const res = await safeFetch(`${scheme}${domain}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "Jaser-security-header-scan/1.0 (passive check)" },
      });
      const { checks, grade, score } = evaluateHeaders(res.headers);
      const html = await res.text().catch(() => null);
      const versionInfo = checkVersionDisclosure(res.headers);
      const csp = analyzeCsp(res.headers.get("content-security-policy"));
      const setCookie = typeof (res.headers as any).getSetCookie === "function" ? (res.headers as any).getSetCookie() : [];
      const cookies = analyzeCookies(setCookie);
      return {
        status: "ok",
        grade,
        score,
        checks,
        finalUrl: res.url,
        html,
        origin: new URL(res.url).hostname,
        versionInfo,
        csp,
        cookies,
      };
    } catch {
      continue; // try the next scheme
    }
  }
  return {
    status: "error",
    message: "Could not connect over HTTPS or HTTP.",
    finalUrl: null,
    html: null,
    origin: null,
    versionInfo: { disclosed: false, values: [] },
    csp: analyzeCsp(null),
    cookies: [],
  };
}

async function findSubdomains(domain: string): Promise<WebAppResult["subdomains"]> {
  try {
    // crt.sh — free, public Certificate Transparency log search, no key.
    // We're reading a public log of issued certs, not touching the target.
    const res = await fetch(`https://crt.sh/?q=%25.${domain}&output=json`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { status: "error", message: `crt.sh returned HTTP ${res.status}` };

    const text = await res.text();
    if (!text.trim()) return { status: "not_found" };

    const data = JSON.parse(text) as { name_value: string }[];
    const names = new Set<string>();
    for (const entry of data) {
      for (const name of entry.name_value.split("\n")) {
        const clean = name.trim().toLowerCase().replace(/^\*\./, "");
        if (clean.endsWith(domain)) names.add(clean);
      }
    }

    const list = Array.from(names).sort();
    return list.length > 0 ? { status: "ok", list } : { status: "not_found" };
  } catch {
    return { status: "error", message: "Network error reaching crt.sh." };
  }
}

export async function GET(req: NextRequest) {
  const clientKey = getClientKey(req);
  const rateLimit = checkRateLimit(`webapp:${clientKey}`, 15, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit reached. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 30) } }
    );
  }

  const rawTarget = req.nextUrl.searchParams.get("target")?.trim();
  const domain = rawTarget ? extractHostname(rawTarget) : undefined;
  if (!domain) {
    return NextResponse.json({ error: "Missing ?target=<domain>" }, { status: 400 });
  }

  const cacheKey = `webapp:${domain}`;
  const cached = cacheGet<WebAppResult>(cacheKey);
  if (cached) return NextResponse.json(cached);

  // SSRF protection: resolve the target before making any outbound
  // request to it, and refuse if it points at a private/internal/
  // cloud-metadata address.
  const hostCheck = await validateHostForOutboundRequest(domain);
  if (!hostCheck.safe) {
    return NextResponse.json({ error: hostCheck.reason }, { status: 400 });
  }

  const [headerResult, subdomains, tlsResult, exposedFiles, corsResult] = await Promise.all([
    scanHeaders(domain),
    findSubdomains(domain),
    checkTlsProtocol(domain, hostCheck.resolvedIp),
    checkExposedFiles(`https://${domain}`),
    checkCorsMisconfig(`https://${domain}`),
  ]);

  const { finalUrl, html, origin, versionInfo, csp, cookies, ...headerScan } = headerResult;

  const owasp = headerResult.status === "ok"
    ? {
        weakTls: tlsResult.weak,
        tlsProtocol: tlsResult.protocol,
        serverVersionDisclosed: versionInfo.disclosed,
        versionHeaders: versionInfo.values,
        exposedFiles,
        missingSri: html && origin ? checkMissingSri(html, origin) : false,
      }
    : null;

  const result: WebAppResult = { target: domain, finalUrl, headerScan, subdomains, owasp, csp, cookies, cors: headerResult.status === "ok" ? corsResult : null };

  cacheSet(cacheKey, result, TTL.ONE_HOUR);
  return NextResponse.json(result);
}
