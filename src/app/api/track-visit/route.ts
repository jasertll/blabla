import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { getClientKey } from "@/lib/rateLimit";

function isPrivateOrLocal(ip: string): boolean {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

async function geolocateCountry(ip: string): Promise<string> {
  if (isPrivateOrLocal(ip)) return "Local / Unknown";
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country`, {
      cache: "no-store",
    });
    if (!res.ok) return "Unknown";
    const data = await res.json();
    return data.status === "success" ? data.country ?? "Unknown" : "Unknown";
  } catch {
    return "Unknown";
  }
}

export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({
      configured: false,
      message:
        "Visitor counter isn't set up yet — add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to your environment.",
    });
  }

  const ip = getClientKey(req);
  const country = await geolocateCountry(ip);

  const [total] = await Promise.all([
    redis.incr("jaser:visits:total"),
    redis.hincrby("jaser:visits:by-country", country, 1),
  ]);

  const byCountry = (await redis.hgetall<Record<string, number>>("jaser:visits:by-country")) ?? {};
  const topCountries = Object.entries(byCountry)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 5)
    .map(([country, count]) => ({ country, count: Number(count) }));

  return NextResponse.json({ configured: true, total, topCountries });
}

export async function GET() {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ configured: false });
  }

  const total = (await redis.get<number>("jaser:visits:total")) ?? 0;
  const byCountry = (await redis.hgetall<Record<string, number>>("jaser:visits:by-country")) ?? {};
  const topCountries = Object.entries(byCountry)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 5)
    .map(([country, count]) => ({ country, count: Number(count) }));

  return NextResponse.json({ configured: true, total, topCountries });
}
