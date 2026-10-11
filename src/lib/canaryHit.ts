import type { Redis } from "@upstash/redis";
import type { NextRequest } from "next/server";
import { getClientKey } from "@/lib/rateLimit";
import { parseUserAgent } from "@/lib/userAgent";
import type { CanaryHit } from "@/lib/canaryTypes";

function isPrivateOrLocal(ip: string): boolean {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

async function geolocate(ip: string): Promise<{ country: string; city: string | null; isp: string | null }> {
  if (ip === "unknown" || isPrivateOrLocal(ip)) return { country: "Local / Unknown", city: null, isp: null };
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,city,isp`, { cache: "no-store" });
    if (!res.ok) return { country: "Unknown", city: null, isp: null };
    const data = await res.json();
    if (data.status !== "success") return { country: "Unknown", city: null, isp: null };
    return { country: data.country ?? "Unknown", city: data.city ?? null, isp: data.isp ?? null };
  } catch {
    return { country: "Unknown", city: null, isp: null };
  }
}

// Shared by both trigger mechanisms — the PDF-embedded JS beacon
// (/api/canary/hit/[token]) and the universal tracked link
// (/api/canary/view/[token]) — so a hit looks identical in the
// dashboard no matter which one fired it. This is a server-side write
// that happens the instant the request lands; it doesn't matter
// whether anyone has the Canary Token tool open in a browser right
// now, this session, or ever again before checking later — the record
// is already sitting in Redis waiting to be read back by /api/canary/list.
export async function logCanaryHit(redis: Redis, req: NextRequest, token: string): Promise<void> {
  const ip = getClientKey(req);
  const ua = req.headers.get("user-agent") ?? "";
  const geo = await geolocate(ip);
  const device = parseUserAgent(ua);
  const hit: CanaryHit = { ip, ...geo, ...device, ua, at: Date.now() };
  await redis.rpush(`jaser:canary:hits:${token}`, hit);
}
