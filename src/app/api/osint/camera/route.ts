import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet, TTL } from "@/lib/cache";
import { validateHostForOutboundRequest, safeFetch } from "@/lib/ssrfGuard";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";

export const runtime = "nodejs";

// Passive, read-only checks against a camera/DVR's own HTTP management
// interface — a banner grab (Server header + <title>) and a standardized
// ONVIF endpoint reachability check. Neither fetches or returns image/video
// content; this never touches or displays a camera's actual feed.
const ONVIF_PATH = "/onvif/device_service";

type CameraProbeResult = {
  target: string;
  http: { reachable: boolean; scheme: string | null; status: number | null; server: string | null; title: string | null };
  onvif: { reachable: boolean; status: number | null };
};

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim().slice(0, 120) : null;
}

async function probeHttp(ip: string): Promise<CameraProbeResult["http"]> {
  for (const scheme of ["http://", "https://"]) {
    try {
      const res = await safeFetch(`${scheme}${ip}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "Jaser-passive-camera-check/1.0" },
      }, 0);
      const server = res.headers.get("server");
      const html = res.status < 400 ? await res.text().catch(() => "") : "";
      return { reachable: true, scheme, status: res.status, server, title: html ? extractTitle(html) : null };
    } catch {
      continue;
    }
  }
  return { reachable: false, scheme: null, status: null, server: null, title: null };
}

async function probeOnvif(ip: string): Promise<CameraProbeResult["onvif"]> {
  try {
    const res = await safeFetch(`http://${ip}${ONVIF_PATH}`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
      headers: { "User-Agent": "Jaser-passive-camera-check/1.0" },
    }, 0);
    // ONVIF services typically reject a bare GET with 400/405 rather than
    // 404 — any non-404 response indicates the standardized endpoint exists.
    return { reachable: res.status !== 404, status: res.status };
  } catch {
    return { reachable: false, status: null };
  }
}

export async function GET(req: NextRequest) {
  const rateLimit = checkRateLimit(`camera:${getClientKey(req)}`, 15, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Rate limit reached. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 30) } });
  }

  const target = req.nextUrl.searchParams.get("target")?.trim();
  if (!target) {
    return NextResponse.json({ error: "Missing ?target=<ip>" }, { status: 400 });
  }

  const hostCheck = await validateHostForOutboundRequest(target);
  if (!hostCheck.safe) {
    return NextResponse.json({ error: hostCheck.reason }, { status: 400 });
  }

  const cacheKey = `camera:${target}`;
  const cached = cacheGet<CameraProbeResult>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const [http, onvif] = await Promise.all([probeHttp(target), probeOnvif(target)]);
  const result: CameraProbeResult = { target, http, onvif };

  cacheSet(cacheKey, result, TTL.ONE_HOUR);
  return NextResponse.json(result);
}
