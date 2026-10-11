import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet, TTL } from "@/lib/cache";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import type { ProviderState } from "@/lib/osintTypes";

export const runtime = "nodejs";

export interface ArchiveLookupResult {
  target: string;
  latest: ProviderState<{ timestamp: string; url: string; date: string }>;
  timeline: ProviderState<{
    firstCapture: string | null;
    lastCapture: string | null;
    totalCaptures: number;
    yearsActive: string[];
  }>;
  snapshots: ProviderState<{ items: { timestamp: string; date: string; url: string; statusCode: string }[]; truncated: boolean }>;
}

function toWaybackDate(ts: string): string {
  // Wayback timestamps are yyyyMMddHHmmss
  const y = ts.slice(0, 4), mo = ts.slice(4, 6), d = ts.slice(6, 8);
  const h = ts.slice(8, 10) || "00", mi = ts.slice(10, 12) || "00", s = ts.slice(12, 14) || "00";
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

async function lookupLatest(target: string): Promise<ArchiveLookupResult["latest"]> {
  try {
    const res = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(target)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { status: "error", provider: "Wayback Availability API", message: `HTTP ${res.status}` };
    const data = await res.json();
    const snap = data?.archived_snapshots?.closest;
    if (!snap || !snap.available) return { status: "not_found", provider: "Wayback Availability API" };
    return {
      status: "ok",
      data: { timestamp: snap.timestamp, url: snap.url, date: toWaybackDate(snap.timestamp) },
    };
  } catch {
    return { status: "error", provider: "Wayback Availability API", message: "Network error or timeout." };
  }
}

// The CDX API indexes every capture ever made of a URL (or, with
// matchType=prefix, of everything under it) — used here for two things:
// a first/last-seen timeline, and a sampled list of individual snapshots
// the user can jump straight to.
async function lookupCdx(target: string): Promise<{ timeline: ArchiveLookupResult["timeline"]; snapshots: ArchiveLookupResult["snapshots"] }> {
  try {
    const url = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(target)}&output=json&collapse=timestamp:8&limit=2000&fl=timestamp,statuscode,original`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      const err: ProviderState<any> = { status: "error", provider: "Wayback CDX API", message: `HTTP ${res.status}` };
      return { timeline: err, snapshots: err };
    }
    const rows: string[][] = await res.json().catch(() => []);
    // First row is the header when results exist ([["timestamp","statuscode","original"], ...])
    const data = rows.length > 1 ? rows.slice(1) : [];
    if (data.length === 0) {
      const nf: ProviderState<any> = { status: "not_found", provider: "Wayback CDX API" };
      return { timeline: nf, snapshots: nf };
    }

    const timestamps = data.map((r) => r[0]).sort();
    const first = timestamps[0];
    const last = timestamps[timestamps.length - 1];
    const years = Array.from(new Set(timestamps.map((t) => t.slice(0, 4)))).sort();

    const CAP = 40;
    // Sample evenly across the full history rather than just the first N —
    // otherwise a domain with thousands of captures only ever shows its
    // earliest days.
    const step = Math.max(1, Math.floor(data.length / CAP));
    const sampled = data.filter((_, i) => i % step === 0).slice(0, CAP);

    return {
      timeline: {
        status: "ok",
        data: {
          firstCapture: toWaybackDate(first),
          lastCapture: toWaybackDate(last),
          totalCaptures: data.length,
          yearsActive: years,
        },
      },
      snapshots: {
        status: "ok",
        data: {
          items: sampled.map((r) => ({
            timestamp: r[0],
            date: toWaybackDate(r[0]),
            url: `https://web.archive.org/web/${r[0]}/${r[2] ?? target}`,
            statusCode: r[1] ?? "?",
          })),
          truncated: data.length > sampled.length,
        },
      },
    };
  } catch {
    const err: ProviderState<any> = { status: "error", provider: "Wayback CDX API", message: "Network error or timeout." };
    return { timeline: err, snapshots: err };
  }
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("target")?.trim();
  if (!target) {
    return NextResponse.json({ error: "Missing ?target=<url-or-domain>" }, { status: 400 });
  }

  const rateLimit = checkRateLimit(`archive:${getClientKey(req)}`, 15, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit reached. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 30) } }
    );
  }

  const cacheKey = `archive:${target.toLowerCase()}`;
  const cached = cacheGet<ArchiveLookupResult>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const [latest, cdx] = await Promise.all([lookupLatest(target), lookupCdx(target)]);

  const result: ArchiveLookupResult = {
    target,
    latest,
    timeline: cdx.timeline,
    snapshots: cdx.snapshots,
  };

  cacheSet(cacheKey, result, TTL.ONE_HOUR);
  return NextResponse.json(result);
}
