import type { ProviderState } from "@/lib/osintTypes";

// Frankfurter (frankfurter.app) — free, keyless, ECB-sourced daily FX
// reference rates. Used here as a rough USD-strength proxy via EUR/USD
// (EUR/USD falling implies USD strengthening, and vice versa), since the
// real ICE DXY index isn't published as a free keyless feed anywhere.
// Always surfaced as a proxy, never labeled as the actual DXY.

export async function fetchDollarProxyTrend(): Promise<ProviderState<{ eurUsd: number; usdTrend: "up" | "down" | "flat" }>> {
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 10 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const url = `https://api.frankfurter.app/${fmt(start)}..${fmt(end)}?from=EUR&to=USD`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { status: "error", provider: "Frankfurter", message: `HTTP ${res.status}` };

    const json = await res.json();
    const rates = json.rates as Record<string, { USD: number }> | undefined;
    if (!rates) return { status: "not_found", provider: "Frankfurter" };

    const dates = Object.keys(rates).sort();
    if (dates.length < 2) return { status: "not_found", provider: "Frankfurter" };

    const latestEurUsd = rates[dates[dates.length - 1]].USD;
    const priorEurUsd = rates[dates[dates.length - 2]].USD;

    const usdTrend = latestEurUsd > priorEurUsd ? "down" : latestEurUsd < priorEurUsd ? "up" : "flat";
    return { status: "ok", data: { eurUsd: latestEurUsd, usdTrend } };
  } catch {
    return { status: "error", provider: "Frankfurter", message: "Network error reaching Frankfurter." };
  }
}
