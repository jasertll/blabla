import { NextResponse } from "next/server";

export const revalidate = 3600; // CISA KEV updates infrequently — cache 1h

const KEV_URL =
  "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

export async function GET() {
  try {
    const res = await fetch(KEV_URL, { next: { revalidate: 3600 } });
    if (!res.ok) {
      return NextResponse.json(
        { error: `CISA KEV feed returned ${res.status}`, items: [] },
        { status: 502 }
      );
    }
    const data = await res.json();
    const items = (data.vulnerabilities ?? [])
      .slice(-15)
      .reverse()
      .map((v: any) => ({
        cveID: v.cveID,
        vendorProject: v.vendorProject,
        product: v.product,
        vulnerabilityName: v.vulnerabilityName,
        dateAdded: v.dateAdded,
        dueDate: v.dueDate,
        requiredAction: v.requiredAction,
        knownRansomwareUse: v.knownRansomwareCampaignUse === "Known",
      }));

    return NextResponse.json({ items, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to reach CISA KEV feed", items: [] },
      { status: 502 }
    );
  }
}
