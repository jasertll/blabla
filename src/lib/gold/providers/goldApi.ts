import type { ProviderState } from "@/lib/osintTypes";

// gold-api.com — a free, keyless public spot-price endpoint for XAU. No
// signup, no token, nothing that can be misconfigured or run out of
// quota on our end. This is the PRIMARY source for the plain "current
// price" (see marketData.ts) — TwelveData/Finnhub are only tried for
// quote if this fails, which keeps that routine, high-frequency traffic
// off their shared, rate-limited budget entirely on a normal day. It
// only ever supplies a current price, never OHLC candle history, so the
// actual multi-timeframe analysis (regime/structure/SL/TP) still runs on
// TwelveData/Finnhub exactly as before — this provider can't replace
// that, only the live-price number.
const PROVIDER = "gold-api.com";
const URL = "https://api.gold-api.com/price/XAU";

export async function fetchGoldQuote(): Promise<ProviderState<{ price: number; bid: null; ask: null; timestamp: number }>> {
  try {
    const res = await fetch(URL, { cache: "no-store" });
    if (res.status === 429) return { status: "rate_limited", provider: PROVIDER };
    if (!res.ok) return { status: "error", provider: PROVIDER, message: `HTTP ${res.status}` };

    const json = await res.json();
    // Response shape isn't independently verifiable from this environment
    // (outbound access to third-party hosts is blocked here) — accept a
    // few plausible field names defensively rather than assuming one, and
    // fail honestly with "not_found" if none of them parse to a real number.
    const raw = json?.price ?? json?.rate ?? json?.ask ?? json?.value;
    const price = typeof raw === "number" ? raw : parseFloat(raw);
    if (!Number.isFinite(price) || price <= 0) return { status: "not_found", provider: PROVIDER };

    const ts = json?.updatedAt ?? json?.timestamp ?? json?.updated_at;
    const timestamp = typeof ts === "number" ? (ts > 1e12 ? ts : ts * 1000) : ts ? new Date(ts).getTime() : Date.now();

    return { status: "ok", data: { price, bid: null, ask: null, timestamp: Number.isFinite(timestamp) ? timestamp : Date.now() } };
  } catch {
    return { status: "error", provider: PROVIDER, message: "Network error reaching gold-api.com." };
  }
}
