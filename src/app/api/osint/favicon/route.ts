import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet, TTL } from "@/lib/cache";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import { validateHostForOutboundRequest, safeFetch } from "@/lib/ssrfGuard";
import { shodanFaviconHash } from "@/lib/faviconHash";
import type { ProviderState } from "@/lib/osintTypes";

export const runtime = "nodejs";

const MAX_BYTES = 512 * 1024; // favicons are small; refuse anything absurd
const UA = "Jaser-favicon-pivot/1.0 (passive check)";

export interface FaviconLookupResult {
  target: string;
  favicon: ProviderState<{
    faviconUrl: string;
    hash: number;
    sizeBytes: number;
    previewDataUri: string | null;
    shodanUrl: string;
    censysUrl: string;
  }>;
}

async function fetchFaviconBytes(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const res = await safeFetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": UA },
  });
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;
  return { bytes: new Uint8Array(buf), contentType: res.headers.get("content-type") ?? "image/x-icon" };
}

function extractIconHref(html: string): string | null {
  const patterns = [
    /<link[^>]+rel=["'](?:shortcut icon|icon|apple-touch-icon)["'][^>]*>/i,
  ];
  for (const p of patterns) {
    const tag = html.match(p)?.[0];
    if (!tag) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (href) return href;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("target")?.trim().toLowerCase();
  if (!target) {
    return NextResponse.json({ error: "Missing ?target=<domain>" }, { status: 400 });
  }

  const rateLimit = checkRateLimit(`favicon:${getClientKey(req)}`, 15, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit reached. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 30) } }
    );
  }

  const cacheKey = `favicon:${target}`;
  const cached = cacheGet<FaviconLookupResult>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const hostCheck = await validateHostForOutboundRequest(target);
  if (!hostCheck.safe) {
    const result: FaviconLookupResult = {
      target,
      favicon: { status: "error", provider: "Favicon fetch", message: hostCheck.reason },
    };
    return NextResponse.json(result);
  }

  let favicon: FaviconLookupResult["favicon"];
  try {
    let faviconUrl = `https://${target}/favicon.ico`;
    let fetched = await fetchFaviconBytes(faviconUrl).catch(() => null);

    if (!fetched) {
      // Fall back to parsing the homepage for an explicit <link rel="icon">
      // — many sites don't serve a bare /favicon.ico at all.
      const homeRes = await safeFetch(`https://${target}/`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": UA },
      });
      const html = await homeRes.text();
      const href = extractIconHref(html);
      if (href) {
        const resolved = new URL(href, homeRes.url).toString();
        const resolvedHost = new URL(resolved).hostname;
        const check2 = await validateHostForOutboundRequest(resolvedHost);
        if (check2.safe) {
          faviconUrl = resolved;
          fetched = await fetchFaviconBytes(resolved).catch(() => null);
        }
      }
    }

    if (!fetched) {
      favicon = { status: "not_found", provider: "Favicon fetch" };
    } else {
      const hash = shodanFaviconHash(fetched.bytes);
      const isPreviewable = fetched.bytes.length < 40 * 1024;
      const previewDataUri = isPreviewable
        ? `data:${fetched.contentType};base64,${Buffer.from(fetched.bytes).toString("base64")}`
        : null;
      favicon = {
        status: "ok",
        data: {
          faviconUrl,
          hash,
          sizeBytes: fetched.bytes.length,
          previewDataUri,
          shodanUrl: `https://www.shodan.io/search?query=http.favicon.hash%3A${hash}`,
          censysUrl: `https://search.censys.io/search?resource=hosts&q=services.http.response.favicons.hashes%3A${hash}`,
        },
      };
    }
  } catch (err) {
    favicon = { status: "error", provider: "Favicon fetch", message: err instanceof Error ? err.message : "Network error." };
  }

  const result: FaviconLookupResult = { target, favicon };
  cacheSet(cacheKey, result, TTL.ONE_HOUR);
  return NextResponse.json(result);
}
