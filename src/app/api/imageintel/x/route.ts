import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import { searchX } from "@/lib/imageIntel/providers/x";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const rateLimit = checkRateLimit(`imageintel-x:${getClientKey(req)}`, 20, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Rate limit reached. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 30) } });
  }

  const body = await req.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim().slice(0, 500) : "";
  if (!query) return NextResponse.json({ error: "Missing query." }, { status: 400 });

  const result = await searchX(query);
  return NextResponse.json(result);
}
