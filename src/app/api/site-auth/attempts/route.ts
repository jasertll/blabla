import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";

// No auth check needed here beyond what proxy.ts already does —
// every /api/ path requires the site-auth cookie except the handful
// explicitly excluded in its matcher, and this route isn't one of
// them. So only whoever is already logged in can ever read this.
const FAILED_LOG_KEY = "jaser:site-auth:failed-log";

export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ configured: false });

  const raw = (await redis.lrange<string>(FAILED_LOG_KEY, -20, -1).catch(() => [])) ?? [];
  const attempts = raw
    .map((entry) => {
      try {
        // The Upstash SDK sometimes hands back already-parsed objects
        // instead of the raw string depending on how the value was
        // stored — handle both rather than assuming.
        return typeof entry === "string" ? JSON.parse(entry) : entry;
      } catch {
        return null;
      }
    })
    .filter((e): e is { ip: string; time: number } => !!e && typeof e.time === "number")
    .reverse();

  return NextResponse.json({ configured: true, attempts });
}
