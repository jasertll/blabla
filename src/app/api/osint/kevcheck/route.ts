import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet, TTL } from "@/lib/cache";

export const runtime = "nodejs";

const KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

type KevEntry = {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  dueDate: string;
  knownRansomwareUse: boolean;
};

// The existing /api/kev route only returns the 15 MOST RECENT entries
// (it's built for a "latest additions" feed, not lookups) — cross-
// referencing a CVE found on a scanned host against just those 15 would
// almost always miss a real match. This route instead caches the FULL
// CISA KEV catalog (1300+ entries) for real matching: "is this specific
// CVE one CISA has confirmed is being actively exploited in the wild."
async function getFullKevMap(): Promise<Map<string, KevEntry>> {
  const cacheKey = "kev:full";
  const cached = cacheGet<Record<string, KevEntry>>(cacheKey);
  if (cached) return new Map(Object.entries(cached));

  const res = await fetch(KEV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`CISA KEV feed returned ${res.status}`);
  const data = await res.json();
  const entries: KevEntry[] = (data.vulnerabilities ?? []).map((v: any) => ({
    cveID: v.cveID,
    vendorProject: v.vendorProject,
    product: v.product,
    vulnerabilityName: v.vulnerabilityName,
    dateAdded: v.dateAdded,
    dueDate: v.dueDate,
    knownRansomwareUse: v.knownRansomwareCampaignUse === "Known",
  }));
  const map = new Map(entries.map((e) => [e.cveID.toUpperCase(), e]));
  cacheSet(cacheKey, Object.fromEntries(map), TTL.ONE_HOUR);
  return map;
}

export async function GET(req: NextRequest) {
  const cvesParam = req.nextUrl.searchParams.get("cves");
  if (!cvesParam) {
    return NextResponse.json({ error: "Missing ?cves=CVE-XXXX-XXXXX,..." }, { status: 400 });
  }
  const requested = cvesParam
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 50);

  try {
    const kevMap = await getFullKevMap();
    const matches = requested.map((cve) => kevMap.get(cve)).filter((x): x is KevEntry => !!x);
    return NextResponse.json({ matches, checkedCount: requested.length });
  } catch {
    return NextResponse.json({ error: "Failed to reach CISA KEV feed", matches: [], checkedCount: requested.length }, { status: 502 });
  }
}
