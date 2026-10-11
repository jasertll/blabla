import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet, TTL } from "@/lib/cache";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";

type CveDetail = {
  id: string;
  description: string;
  score: number | null;
  severity: string | null;
  cwe: string[];
  affectedProducts: string[];
  published: string | null;
  lastModified: string | null;
  references: string[];
  inKev: boolean;
  kevDueDate: string | null;
  kevRansomwareUse: boolean;
  epss: { score: number; percentile: number } | null;
  careAssessment: { level: "URGENT" | "HIGH" | "MODERATE" | "LOW"; reasons: string[] };
};

const KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

async function checkKev(id: string): Promise<{ inKev: boolean; dueDate: string | null; ransomware: boolean }> {
  try {
    const res = await fetch(KEV_URL, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { inKev: false, dueDate: null, ransomware: false };
    const data = await res.json();
    const entry = (data.vulnerabilities ?? []).find((v: any) => v.cveID === id);
    if (!entry) return { inKev: false, dueDate: null, ransomware: false };
    return { inKev: true, dueDate: entry.dueDate ?? null, ransomware: entry.knownRansomwareCampaignUse === "Known" };
  } catch {
    return { inKev: false, dueDate: null, ransomware: false };
  }
}

async function fetchEpss(id: string): Promise<{ score: number; percentile: number } | null> {
  try {
    // FIRST.org EPSS API — free, public, no key. Gives the probability
    // (0-1) that this CVE will be exploited in the wild in the next 30 days.
    const res = await fetch(`https://api.first.org/data/v1/epss?cveId=${id}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const entry = data.data?.[0];
    if (!entry) return null;
    return { score: parseFloat(entry.epss), percentile: parseFloat(entry.percentile) };
  } catch {
    return null;
  }
}

function assessCare(score: number | null, inKev: boolean, ransomware: boolean, epss: number | null): CveDetail["careAssessment"] {
  const reasons: string[] = [];
  let points = 0;

  if (score !== null && score >= 9) { points += 3; reasons.push(`CVSS ${score} — critical severity`); }
  else if (score !== null && score >= 7) { points += 2; reasons.push(`CVSS ${score} — high severity`); }

  if (inKev) { points += 3; reasons.push("Confirmed actively exploited (CISA KEV)"); }
  if (ransomware) { points += 2; reasons.push("Known ransomware campaign use"); }
  if (epss !== null && epss >= 0.5) { points += 2; reasons.push(`EPSS ${(epss * 100).toFixed(0)}% — high real-world exploitation probability`); }
  else if (epss !== null && epss >= 0.1) { points += 1; reasons.push(`EPSS ${(epss * 100).toFixed(0)}% — non-trivial exploitation probability`); }

  if (reasons.length === 0) reasons.push("No strong urgency signals in the data checked — still patch on normal schedule");

  const level: CveDetail["careAssessment"]["level"] = points >= 6 ? "URGENT" : points >= 4 ? "HIGH" : points >= 2 ? "MODERATE" : "LOW";
  return { level, reasons };
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")?.toUpperCase().trim();
  if (!id || !/^CVE-\d{4}-\d{4,}$/.test(id)) {
    return NextResponse.json({ error: "Invalid CVE ID format — expected CVE-YYYY-NNNNN" }, { status: 400 });
  }

  const rateLimit = checkRateLimit(`cve-lookup:${getClientKey(req)}`, 20, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit reached. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 30) } }
    );
  }

  const cacheKey = `cve-detail:${id}`;
  const cached = cacheGet<CveDetail>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const apiKey = process.env.NVD_API_KEY;

  try {
    const [nvdRes, kev, epss] = await Promise.all([
      fetch(`https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${id}`, {
        headers: apiKey ? { apiKey } : {},
        signal: AbortSignal.timeout(8000),
      }),
      checkKev(id),
      fetchEpss(id),
    ]);

    if (nvdRes.status === 403 || nvdRes.status === 429) {
      return NextResponse.json({ error: "NVD rate limit reached — try again shortly." }, { status: 429 });
    }
    if (!nvdRes.ok) {
      return NextResponse.json({ error: `NVD returned ${nvdRes.status}` }, { status: 502 });
    }

    const data = await nvdRes.json();
    const entry = data.vulnerabilities?.[0]?.cve;
    if (!entry) {
      return NextResponse.json({ error: `${id} not found in NVD.` }, { status: 404 });
    }

    const metric = entry.metrics?.cvssMetricV31?.[0] ?? entry.metrics?.cvssMetricV30?.[0] ?? entry.metrics?.cvssMetricV2?.[0];
    const score = metric?.cvssData?.baseScore ?? null;

    const cwe = (entry.weaknesses ?? [])
      .flatMap((w: any) => w.description ?? [])
      .filter((d: any) => d.lang === "en")
      .map((d: any) => d.value);

    const affectedProducts = Array.from(
      new Set(
        (entry.configurations ?? [])
          .flatMap((c: any) => c.nodes ?? [])
          .flatMap((n: any) => n.cpeMatch ?? [])
          .map((m: any) => m.criteria)
          .filter(Boolean)
      )
    ).slice(0, 10) as string[];

    const detail: CveDetail = {
      id: entry.id,
      description: entry.descriptions?.find((d: any) => d.lang === "en")?.value ?? "",
      score,
      severity: metric?.cvssData?.baseSeverity ?? metric?.baseSeverity ?? null,
      cwe,
      affectedProducts,
      published: entry.published ?? null,
      lastModified: entry.lastModified ?? null,
      references: (entry.references ?? []).slice(0, 6).map((r: any) => r.url),
      inKev: kev.inKev,
      kevDueDate: kev.dueDate,
      kevRansomwareUse: kev.ransomware,
      epss,
      careAssessment: assessCare(score, kev.inKev, kev.ransomware, epss?.score ?? null),
    };

    cacheSet(cacheKey, detail, TTL.ONE_HOUR);
    return NextResponse.json(detail);
  } catch {
    return NextResponse.json({ error: "Failed to reach NVD." }, { status: 502 });
  }
}
