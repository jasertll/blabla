import { NextResponse } from "next/server";

export const revalidate = 1800; // 30 minutes

// NVD API 2.0 — public, but rate-limited (5 req/30s without an API key).
// If NVD_API_KEY is set in .env.local, the request limit raises to 50 req/30s.
const NVD_URL =
  "https://services.nvd.nist.gov/rest/json/cves/2.0?cvssV3Severity=CRITICAL&resultsPerPage=10";

export async function GET() {
  const apiKey = process.env.NVD_API_KEY;

  try {
    const res = await fetch(NVD_URL, {
      headers: apiKey ? { apiKey } : {},
      next: { revalidate: 1800 },
    });

    if (res.status === 403 || res.status === 429) {
      return NextResponse.json(
        {
          error: "NVD rate limit reached. Configure NVD_API_KEY in .env.local for a higher quota.",
          items: [],
        },
        { status: 429 }
      );
    }
    if (!res.ok) {
      return NextResponse.json(
        { error: `NVD returned ${res.status}`, items: [] },
        { status: 502 }
      );
    }

    const data = await res.json();
    const items = (data.vulnerabilities ?? []).map((entry: any) => {
      const cve = entry.cve;
      const metric =
        cve.metrics?.cvssMetricV31?.[0] ?? cve.metrics?.cvssMetricV30?.[0];
      return {
        id: cve.id,
        description:
          cve.descriptions?.find((d: any) => d.lang === "en")?.value ?? "",
        score: metric?.cvssData?.baseScore ?? null,
        published: cve.published,
      };
    });

    return NextResponse.json({ items, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to reach NVD", items: [] },
      { status: 502 }
    );
  }
}
