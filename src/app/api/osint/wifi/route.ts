import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet, TTL } from "@/lib/cache";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import type { ProviderState } from "@/lib/osintTypes";

export const runtime = "nodejs";

export interface WifiLookupResult {
  bssid: string;
  location: ProviderState<{ lat: number; lon: number; rangeMeters: number | null }>;
}

export interface WifiSsidSearchResult {
  ssid: string;
  matches: ProviderState<{
    items: { bssid: string; lat: number; lon: number; encryption: string | null; lastUpdated: string | null; channel: number | null }[];
    truncated: boolean;
  }>;
}

const MAC_RE = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;

// Mylnikov WPS — a free, keyless, community-sourced WiFi geolocation
// database (the same kind of wardriving data GPS-less Android devices
// historically used to estimate location from nearby BSSIDs). Real
// coverage is uneven and skews toward densely wardriven areas — that
// caveat is surfaced honestly in the UI, not hidden.
async function lookupWifi(bssid: string): Promise<WifiLookupResult["location"]> {
  try {
    const res = await fetch(`https://api.mylnikov.org/geolocation/wifi?v=1.1&bssid=${encodeURIComponent(bssid)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { status: "error", provider: "Mylnikov WiFi Geolocation", message: `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (data?.result === 200 && data?.data) {
      return {
        status: "ok",
        data: { lat: data.data.lat, lon: data.data.lon, rangeMeters: data.data.range ?? null },
      };
    }
    return { status: "not_found", provider: "Mylnikov WiFi Geolocation" };
  } catch {
    return { status: "error", provider: "Mylnikov WiFi Geolocation", message: "Network error or timeout." };
  }
}

// WiGLE — the standard wardriving database for searching by network
// *name* instead of needing a BSSID up front (BSSID-only search is a
// dead end when all an investigator has is an SSID). Free account
// required (api.wigle.net → account → "Your Info" for the API name/token
// pair) — same optional-key pattern as HIBP_API_KEY etc. elsewhere in
// this app. Deliberately returns only what WiGLE itself exposes
// (approximate location, encryption type, last-seen) — never a
// password; a live password lookup would directly facilitate
// unauthorized network access, unlike location/metadata.
async function searchWigleBySsid(ssid: string): Promise<WifiSsidSearchResult["matches"]> {
  const apiName = process.env.WIGLE_API_NAME;
  const apiToken = process.env.WIGLE_API_TOKEN;
  if (!apiName || !apiToken) {
    return { status: "missing_key", provider: "WiGLE", envVar: "WIGLE_API_NAME + WIGLE_API_TOKEN" };
  }

  try {
    const auth = Buffer.from(`${apiName}:${apiToken}`).toString("base64");
    const res = await fetch(`https://api.wigle.net/api/v2/network/search?ssid=${encodeURIComponent(ssid)}&resultsPerPage=25`, {
      headers: { Authorization: `Basic ${auth}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 401 || res.status === 403) {
      return { status: "error", provider: "WiGLE", message: "Invalid or expired WiGLE API credentials." };
    }
    if (res.status === 429) return { status: "rate_limited", provider: "WiGLE" };
    if (!res.ok) return { status: "error", provider: "WiGLE", message: `HTTP ${res.status}` };

    const data = await res.json().catch(() => null);
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    if (results.length === 0) return { status: "not_found", provider: "WiGLE" };

    const items = results
      .filter((r) => typeof r.trilat === "number" && typeof r.trilong === "number")
      .map((r) => ({
        bssid: r.netid as string,
        lat: r.trilat as number,
        lon: r.trilong as number,
        encryption: (r.encryption as string) || null,
        lastUpdated: (r.lastupdt as string) || null,
        channel: typeof r.channel === "number" ? r.channel : null,
      }));

    if (items.length === 0) return { status: "not_found", provider: "WiGLE" };
    return { status: "ok", data: { items, truncated: Boolean(data?.resultCount > items.length) } };
  } catch {
    return { status: "error", provider: "WiGLE", message: "Network error or timeout." };
  }
}

export async function GET(req: NextRequest) {
  const bssid = req.nextUrl.searchParams.get("bssid")?.trim().toUpperCase();
  const ssid = req.nextUrl.searchParams.get("ssid")?.trim();

  if (ssid) {
    const rl = checkRateLimit(`wifi-ssid:${getClientKey(req)}`, 15, 60_000);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Rate limit reached, try again shortly." }, { status: 429 });
    }
    const cacheKey = `wifi-ssid:${ssid.toLowerCase()}`;
    const cached = cacheGet<WifiSsidSearchResult>(cacheKey);
    if (cached) return NextResponse.json(cached);

    const matches = await searchWigleBySsid(ssid);
    const result: WifiSsidSearchResult = { ssid, matches };
    cacheSet(cacheKey, result, TTL.ONE_HOUR);
    return NextResponse.json(result);
  }

  if (!bssid || !MAC_RE.test(bssid)) {
    return NextResponse.json(
      { error: "Provide a BSSID/MAC (AA:BB:CC:DD:EE:FF) or a network name via ?ssid=." },
      { status: 400 }
    );
  }

  const rl = checkRateLimit(`wifi:${getClientKey(req)}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limit reached, try again shortly." }, { status: 429 });
  }

  const cacheKey = `wifi:${bssid}`;
  const cached = cacheGet<WifiLookupResult>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const location = await lookupWifi(bssid);
  const result: WifiLookupResult = { bssid, location };
  cacheSet(cacheKey, result, TTL.ONE_HOUR);
  return NextResponse.json(result);
}
