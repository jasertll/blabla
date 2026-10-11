import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import { cacheGetOrFetch } from "@/lib/cache";
import { fetchGoldQuote } from "@/lib/gold/providers/marketData";

export const runtime = "nodejs";

// Deliberately separate from /api/gold/decision: the UI polls this one
// frequently for a "live" price readout, while the full multi-timeframe
// decision recompute stays on a slower cadence. Must match
// /api/gold/decision's own QUOTE_TTL_MS — both write the same
// "gold:quote" cache key, so a mismatch would make whichever route ran
// last silently override the other's freshness window. Tightened from
// 20s: the primary source (gold-api.com) is keyless with no documented
// rate limit, so this TTL only needs to avoid pointless duplicate calls
// within the same second, not protect a quota.
const QUOTE_TTL_MS = 8_000;

export async function GET(req: NextRequest) {
  const clientKey = getClientKey(req);
  const rl = checkRateLimit(`gold-quote:${clientKey}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited." }, { status: 429, headers: rl.retryAfterSeconds ? { "Retry-After": String(rl.retryAfterSeconds) } : undefined });
  }

  const { value: quote } = await cacheGetOrFetch("gold:quote", QUOTE_TTL_MS, () => fetchGoldQuote(), (r) => r.status === "ok", 3 * 60_000);

  if (quote.status !== "ok") {
    return NextResponse.json({ price: null, timestamp: null, status: quote.status });
  }
  return NextResponse.json({ price: quote.data.price, timestamp: quote.data.timestamp, status: "ok" });
}
