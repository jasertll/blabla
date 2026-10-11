import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import { cacheGet, cacheSet } from "@/lib/cache";
import { fetchHeadlines } from "@/lib/gold/providers/newsHeadlines";

export const runtime = "nodejs";

const HEADLINES_TTL_MS = 5 * 60_000;

export async function GET(req: NextRequest) {
  const clientKey = getClientKey(req);
  const rl = checkRateLimit(`gold-news:${clientKey}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited." }, { status: 429 });
  }

  const cacheKey = "gold:headlines";
  const cached = cacheGet<Awaited<ReturnType<typeof fetchHeadlines>>>(cacheKey);
  const result = cached ?? (await fetchHeadlines());
  if (!cached && result.status === "ok") cacheSet(cacheKey, result, HEADLINES_TTL_MS);

  if (result.status !== "ok") {
    const message = result.status === "error" ? result.message : "تعذّر جلب الأخبار.";
    return NextResponse.json({ error: message }, { status: 200 });
  }
  return NextResponse.json(result.data);
}
