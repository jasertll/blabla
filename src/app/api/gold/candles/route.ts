import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import { cacheGetOrFetch } from "@/lib/cache";
import { fetchGoldCandles } from "@/lib/gold/providers/marketData";
import { resampleCandles } from "@/lib/gold/resample";
import type { Timeframe } from "@/lib/gold/types";

export const runtime = "nodejs";

// Deliberately longer than GoldChart's 60s poll interval — see the same
// reasoning in /api/gold/decision's CANDLES_TTL_MS.
const CANDLES_TTL_MS = 90_000;

// 1H/15M are fetched at the same bumped counts /api/gold/decision uses
// (see its FETCH_1H_COUNT/FETCH_15M_COUNT) so viewing 1H or 15M on the
// chart hits that same cache entry instead of making its own separate
// provider call. 4H and 30M are derived from those same cached fetches
// via resampleCandles() rather than fetched directly — see the longer
// explanation in /api/gold/decision/route.ts for why: a direct 4H/30M
// call here used to be a 7th/8th TwelveData request nothing else needed.
const ALLOWED: Record<string, number> = {
  "5min": 200,
  "15min": 340,
  "30min": 340, // derived from the 15min:340 fetch above, not its own call
  "1h": 500,
  "4h": 500, // derived from the 1h:500 fetch above, not its own call
  "1day": 30,
};
const RESAMPLE: Partial<Record<string, { from: Timeframe; factor: number; take: number }>> = {
  "4h": { from: "1h", factor: 4, take: 120 },
  "30min": { from: "15min", factor: 2, take: 150 },
};
const NATIVE_TAKE: Partial<Record<string, number>> = { "15min": 200, "1h": 150 };

export async function GET(req: NextRequest) {
  const clientKey = getClientKey(req);
  const rl = checkRateLimit(`gold-candles:${clientKey}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited." }, { status: 429 });
  }

  const tf = (req.nextUrl.searchParams.get("tf") ?? "15min") as Timeframe;
  const resample = RESAMPLE[tf];
  const fetchTf = resample?.from ?? tf;
  const count = ALLOWED[fetchTf];
  if (!count) {
    return NextResponse.json({ error: "Unsupported timeframe." }, { status: 400 });
  }

  const cacheKey = `gold:candles:${fetchTf}:${count}`;
  const { value: result } = await cacheGetOrFetch(cacheKey, CANDLES_TTL_MS, () => fetchGoldCandles(fetchTf, count), (r) => r.status === "ok", 15 * 60_000);

  if (result.status !== "ok") {
    const message =
      result.status === "missing_key"
        ? "مفتاح TWELVEDATA_API_KEY غير مضبوط."
        : result.status === "rate_limited"
        ? "تجاوز حد الطلبات لدى المزوّد."
        : result.status === "not_found"
        ? "لا توجد بيانات."
        : result.message ?? "خطأ غير معروف.";
    return NextResponse.json({ error: message }, { status: 200 });
  }

  if (resample) {
    const candles = resampleCandles(result.data, resample.factor).slice(-resample.take);
    return NextResponse.json({ candles });
  }
  const nativeTake = NATIVE_TAKE[tf];
  const candles = nativeTake ? result.data.slice(-nativeTake) : result.data;
  return NextResponse.json({ candles });
}
