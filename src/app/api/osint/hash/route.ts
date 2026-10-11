import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet, TTL } from "@/lib/cache";
import type { HashLookupResult } from "@/lib/osintTypes";
import { detectIndicator } from "@/lib/detectIndicator";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";

export async function GET(req: NextRequest) {
  const hash = req.nextUrl.searchParams.get("target");
  if (!hash) {
    return NextResponse.json({ error: "Missing ?target=<hash>" }, { status: 400 });
  }

  const rateLimit = checkRateLimit(`hash:${getClientKey(req)}`, 30, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit reached. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 30) } }
    );
  }

  const cacheKey = `hash:${hash}`;
  const cached = cacheGet<HashLookupResult>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const kind = detectIndicator(hash); // md5 | sha1 | sha256
  const algo = kind === "md5" ? "md5" : kind === "sha1" ? "sha1" : "sha256";

  let circlHashlookup: HashLookupResult["circlHashlookup"];

  try {
    // CIRCL hashlookup — free, public, no API key. It checks the hash
    // against known-good file sets (NSRL etc.), NOT a malware database.
    const res = await fetch(`https://hashlookup.circl.lu/lookup/${algo}/${hash}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (res.status === 404) {
      circlHashlookup = { status: "not_found", provider: "CIRCL hashlookup" };
    } else if (res.status === 429) {
      circlHashlookup = { status: "rate_limited", provider: "CIRCL hashlookup" };
    } else if (!res.ok) {
      circlHashlookup = { status: "error", provider: "CIRCL hashlookup", message: `HTTP ${res.status}` };
    } else {
      const data = await res.json();
      circlHashlookup = {
        status: "ok",
        data: {
          fileName: data.FileName ?? null,
          product: data.ProductCode?.ApplicationType ?? null,
          trustLevel: typeof data["hashlookup:trust"] === "number" ? data["hashlookup:trust"] : null,
        },
      };
    }
  } catch {
    circlHashlookup = { status: "error", provider: "CIRCL hashlookup", message: "Network error." };
  }

  const result: HashLookupResult = { target: hash, circlHashlookup };
  cacheSet(cacheKey, result, TTL.ONE_HOUR);
  return NextResponse.json(result);
}
