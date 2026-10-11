import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet, TTL } from "@/lib/cache";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import { generateTyposquats, TyposquatCandidate } from "@/lib/typosquat";

export const runtime = "nodejs";

export interface TyposquatResult {
  target: string;
  candidates: {
    domain: string;
    category: TyposquatCandidate["category"];
    registered: boolean | null; // null = lookup failed, not a registration signal
  }[];
  registeredCount: number;
  checkedCount: number;
}

// Cloudflare DNS-over-HTTPS — same keyless resolver already used for the
// DNSSEC check in the domain-scan route. "Registered" here just means an A
// record resolves; it's a presence signal, not a WHOIS/ownership check.
async function isRegistered(domain: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
      headers: { Accept: "application/dns-json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.Answer) && data.Answer.length > 0;
  } catch {
    return null;
  }
}

// Small concurrency cap so a single request doesn't fire 40 simultaneous
// outbound DNS queries at once.
async function checkAllWithLimit(candidates: TyposquatCandidate[], limit = 6): Promise<TyposquatResult["candidates"]> {
  const results: TyposquatResult["candidates"] = new Array(candidates.length);
  let cursor = 0;

  async function worker() {
    while (cursor < candidates.length) {
      const i = cursor++;
      const c = candidates[i];
      const registered = await isRegistered(c.domain);
      results[i] = { domain: c.domain, category: c.category, registered };
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, candidates.length) }, worker));
  return results;
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("target")?.trim().toLowerCase();
  if (!target) {
    return NextResponse.json({ error: "Missing ?target=<domain>" }, { status: 400 });
  }

  const rateLimit = checkRateLimit(`typosquat:${getClientKey(req)}`, 8, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit reached. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 30) } }
    );
  }

  const cacheKey = `typosquat:${target}`;
  const cached = cacheGet<TyposquatResult>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const candidates = generateTyposquats(target, 40);
  if (candidates.length === 0) {
    return NextResponse.json({ error: "Enter a domain with a valid TLD, e.g. example.com" }, { status: 400 });
  }

  const checked = await checkAllWithLimit(candidates);
  const registeredCount = checked.filter((c) => c.registered === true).length;

  // Registered hits first, then by category, so the interesting results
  // don't get buried under 30 "not registered" rows.
  checked.sort((a, b) => {
    if (a.registered === b.registered) return a.category.localeCompare(b.category);
    if (a.registered === true) return -1;
    if (b.registered === true) return 1;
    return 0;
  });

  const result: TyposquatResult = {
    target,
    candidates: checked,
    registeredCount,
    checkedCount: checked.length,
  };

  cacheSet(cacheKey, result, TTL.ONE_HOUR);
  return NextResponse.json(result);
}
