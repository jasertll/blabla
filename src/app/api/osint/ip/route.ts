import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet, TTL } from "@/lib/cache";
import type { IpLookupResult } from "@/lib/osintTypes";
import dns from "node:dns/promises";

export const runtime = "nodejs";

// All sources below are free and require no API key or signup.

async function reverseDns(ip: string): Promise<IpLookupResult["reverseDns"]> {
  try {
    const hostnames = await dns.reverse(ip);
    return hostnames.length > 0 ? { status: "ok", data: { hostnames } } : { status: "not_found", provider: "Reverse DNS (PTR)" };
  } catch (err: any) {
    if (err?.code === "ENOTFOUND") return { status: "not_found", provider: "Reverse DNS (PTR)" };
    return { status: "error", provider: "Reverse DNS (PTR)", message: "Lookup failed." };
  }
}

// DNSBL check via Spamhaus ZEN — the standard free, keyless technique:
// query the reversed IP octets as a subdomain of the blacklist zone. A
// resolved A record (typically 127.0.0.x) means the IP is listed; NXDOMAIN
// means it's clean. This is a real DNS query, not a fabricated result.
async function checkBlacklist(ip: string): Promise<IpLookupResult["blacklist"]> {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    return { status: "not_found", provider: "Spamhaus ZEN" }; // IPv6 not supported by this zone
  }
  try {
    const reversed = ip.split(".").reverse().join(".");
    const result = await dns.resolve4(`${reversed}.zen.spamhaus.org`);
    return { status: "ok", data: { listed: result.length > 0, lists: ["Spamhaus ZEN"] } };
  } catch (err: any) {
    if (err?.code === "ENOTFOUND" || err?.code === "ENODATA") {
      return { status: "ok", data: { listed: false, lists: [] } };
    }
    return { status: "error", provider: "Spamhaus ZEN", message: "Lookup failed." };
  }
}

async function lookupInternetDb(ip: string): Promise<IpLookupResult["internetdb"]> {
  try {
    const res = await fetch(`https://internetdb.shodan.io/${ip}`, { cache: "no-store" });

    if (res.status === 404) return { status: "not_found", provider: "Shodan InternetDB" };
    if (res.status === 429) return { status: "rate_limited", provider: "Shodan InternetDB" };
    if (!res.ok) {
      return { status: "error", provider: "Shodan InternetDB", message: `HTTP ${res.status}` };
    }

    const data = await res.json();
    return {
      status: "ok",
      data: {
        ports: data.ports ?? [],
        hostnames: data.hostnames ?? [],
        cpes: data.cpes ?? [],
        tags: data.tags ?? [],
        vulns: data.vulns ?? [],
      },
    };
  } catch {
    return { status: "error", provider: "Shodan InternetDB", message: "Network error." };
  }
}

async function lookupGeo(ip: string): Promise<IpLookupResult["geo"]> {
  try {
    // ip-api.com free tier: 45 requests/minute, no key. HTTPS requires the
    // (still free) "pro" endpoint on some plans — http works for the free tier.
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,message,country,city,lat,lon,isp,org,proxy,hosting,mobile`,
      { cache: "no-store" }
    );

    if (!res.ok) return { status: "error", provider: "ip-api.com", message: `HTTP ${res.status}` };

    const data = await res.json();
    if (data.status !== "success") {
      return { status: "not_found", provider: "ip-api.com" };
    }

    return {
      status: "ok",
      data: {
        country: data.country ?? null,
        city: data.city ?? null,
        lat: typeof data.lat === "number" ? data.lat : null,
        lon: typeof data.lon === "number" ? data.lon : null,
        isp: data.isp ?? null,
        org: data.org ?? null,
        isProxy: Boolean(data.proxy),
        isHosting: Boolean(data.hosting),
        isMobile: Boolean(data.mobile),
      },
    };
  } catch {
    return { status: "error", provider: "ip-api.com", message: "Network error." };
  }
}

async function lookupAsn(ip: string): Promise<IpLookupResult["asn"]> {
  try {
    const res = await fetch(`https://api.bgpview.io/ip/${ip}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 404) return { status: "not_found", provider: "BGPView" };
    if (res.status === 429) return { status: "rate_limited", provider: "BGPView" };
    if (!res.ok) return { status: "error", provider: "BGPView", message: `HTTP ${res.status}` };

    const body = await res.json();
    const prefixes: any[] = body?.data?.prefixes ?? [];
    if (prefixes.length === 0) return { status: "not_found", provider: "BGPView" };

    // BGPView lists every announced prefix covering this IP — the first is
    // typically the most specific (longest-match) route, which is the one
    // an operator actually cares about.
    const top = prefixes[0];
    return {
      status: "ok",
      data: {
        asn: top.asn?.asn ?? null,
        holder: top.asn?.name ?? null,
        description: top.asn?.description ?? top.description ?? null,
        countryCode: top.asn?.country_code ?? top.country_code ?? null,
        prefix: top.prefix ?? null,
        allocationDate: body?.data?.rir_allocation?.date_allocated ?? null,
        rir: body?.data?.rir_allocation?.rir_name ?? null,
      },
    };
  } catch {
    return { status: "error", provider: "BGPView", message: "Network error." };
  }
}

async function lookupIpRdap(ip: string): Promise<IpLookupResult["rdap"]> {
  try {
    const res = await fetch(`https://rdap.org/ip/${ip}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/rdap+json" },
    });

    if (res.status === 404) return { status: "not_found", provider: "RDAP" };
    if (!res.ok) return { status: "error", provider: "RDAP", message: `HTTP ${res.status}` };

    const data = await res.json();
    const orgEntity = (data.entities ?? []).find((e: any) =>
      e.roles?.includes("registrant") || e.roles?.includes("administrative")
    );
    const orgName =
      orgEntity?.vcardArray?.[1]?.find((v: any) => v[0] === "fn")?.[3] ??
      data.name ??
      null;

    return {
      status: "ok",
      data: {
        handle: data.handle ?? null,
        name: data.name ?? null,
        country: data.country ?? null,
        startAddress: data.startAddress ?? null,
        endAddress: data.endAddress ?? null,
        cidr: Array.isArray(data.cidr0_cidrs) && data.cidr0_cidrs[0]
          ? `${data.cidr0_cidrs[0].v4prefix ?? data.cidr0_cidrs[0].v6prefix}/${data.cidr0_cidrs[0].length}`
          : null,
        org: orgName,
        parentHandle: data.parentHandle ?? null,
      },
    };
  } catch {
    return { status: "error", provider: "RDAP", message: "Network error." };
  }
}

// Cache the Tor exit-node list itself for a few minutes rather than
// re-downloading the full list on every single IP lookup.
let torListCache: { ips: Set<string>; expiresAt: number } | null = null;

async function isTorExitNode(ip: string): Promise<IpLookupResult["tor"]> {
  try {
    if (!torListCache || Date.now() > torListCache.expiresAt) {
      const res = await fetch("https://check.torproject.org/torbulkexitlist", {
        cache: "no-store",
      });
      if (!res.ok) {
        return { status: "error", provider: "Tor Project", message: `HTTP ${res.status}` };
      }
      const text = await res.text();
      const ips = new Set(text.split("\n").map((l) => l.trim()).filter(Boolean));
      torListCache = { ips, expiresAt: Date.now() + TTL.FIVE_MINUTES };
    }

    return { status: "ok", data: { isTorExitNode: torListCache.ips.has(ip) } };
  } catch {
    return { status: "error", provider: "Tor Project", message: "Network error." };
  }
}

export async function GET(req: NextRequest) {
  const ip = req.nextUrl.searchParams.get("target");
  if (!ip) {
    return NextResponse.json({ error: "Missing ?target=<ip>" }, { status: 400 });
  }

  const rateLimit = checkRateLimit(`ip:${getClientKey(req)}`, 30, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit reached. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 30) } }
    );
  }

  const cacheKey = `ip:${ip}`;
  const cached = cacheGet<IpLookupResult>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const [internetdb, geo, tor, reverseDnsResult, blacklist, asn, rdap] = await Promise.all([
    lookupInternetDb(ip),
    lookupGeo(ip),
    isTorExitNode(ip),
    reverseDns(ip),
    checkBlacklist(ip),
    lookupAsn(ip),
    lookupIpRdap(ip),
  ]);

  const result: IpLookupResult = {
    target: ip,
    internetdb,
    geo,
    tor,
    reverseDns: reverseDnsResult,
    blacklist,
    asn,
    rdap,
  };
  cacheSet(cacheKey, result, TTL.FIVE_MINUTES);

  return NextResponse.json(result);
}
