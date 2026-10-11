import type { ProviderState } from "@/lib/osintTypes";

// U.S. Department of the Treasury — official first-party daily par yield
// curve rates, published as an open CSV download. No API key, no signup,
// no rate limit — this is a public government data file, not a vendor API.

const BASE = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv";

function parseCsv(text: string): string[][] {
  return text
    .trim()
    .split("\n")
    .map((line) => line.split(",").map((cell) => cell.replace(/^"|"$/g, "").trim()));
}

export async function fetchTreasuryYieldTrend(
  tenor: "10 Yr" | "2 Yr"
): Promise<ProviderState<{ latest: number; trend: "up" | "down" | "flat" }>> {
  try {
    const year = new Date().getUTCFullYear();
    const url = `${BASE}/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { status: "error", provider: "US Treasury", message: `HTTP ${res.status}` };

    const text = await res.text();
    const rows = parseCsv(text);
    if (rows.length < 3) return { status: "not_found", provider: "US Treasury" };

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const colIdx = header.findIndex((h) => h === tenor.toLowerCase());
    if (colIdx === -1) return { status: "error", provider: "US Treasury", message: `Column "${tenor}" not found in Treasury CSV.` };

    const dataRows = rows
      .slice(1)
      .filter((r) => r[colIdx] && r[0] && !isNaN(parseFloat(r[colIdx])))
      .map((r) => ({ date: new Date(r[0]), value: parseFloat(r[colIdx]) }))
      .filter((r) => !isNaN(r.date.getTime()))
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    if (dataRows.length < 2) return { status: "not_found", provider: "US Treasury" };

    const latest = dataRows[0].value;
    const prior = dataRows[1].value;
    const trend = latest > prior ? "up" : latest < prior ? "down" : "flat";
    return { status: "ok", data: { latest, trend } };
  } catch {
    return { status: "error", provider: "US Treasury", message: "Network error reaching Treasury.gov." };
  }
}
