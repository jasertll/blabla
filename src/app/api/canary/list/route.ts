import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import type { CanaryHit, CanaryTokenMeta, CanaryTokenWithHits } from "@/lib/canaryTypes";

export const runtime = "nodejs";
// Without this, Next.js statically prerenders this route at build time
// (it has no request-dependent signal otherwise) and bakes in whatever
// getRedis() returns then — permanently "not configured" if the env
// vars weren't set at build time, regardless of runtime configuration.
export const dynamic = "force-dynamic";

export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ configured: false, tokens: [] });

  const tokensMap = (await redis.hgetall<Record<string, CanaryTokenMeta>>("jaser:canary:tokens")) ?? {};

  const tokens: CanaryTokenWithHits[] = await Promise.all(
    Object.entries(tokensMap).map(async ([token, meta]) => {
      const hits = (await redis.lrange<CanaryHit>(`jaser:canary:hits:${token}`, 0, -1)) ?? [];
      return { token, ...meta, hits: hits.slice().sort((a, b) => b.at - a.at) };
    })
  );

  tokens.sort((a, b) => b.createdAt - a.createdAt);
  return NextResponse.json({ configured: true, tokens });
}
