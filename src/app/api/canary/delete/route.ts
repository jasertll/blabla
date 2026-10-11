import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "not_configured" }, { status: 200 });

  const body = await req.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) return NextResponse.json({ error: "missing_token" }, { status: 400 });

  await Promise.all([
    redis.hdel("jaser:canary:tokens", token),
    redis.del(`jaser:canary:hits:${token}`),
    redis.del(`jaser:canary:file:${token}`),
  ]);
  return NextResponse.json({ ok: true });
}
