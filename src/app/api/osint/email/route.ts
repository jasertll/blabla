import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { cacheGet, cacheSet, TTL } from "@/lib/cache";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import type { ProviderState } from "@/lib/osintTypes";

export const runtime = "nodejs";

export interface EmailLookupResult {
  target: string;
  gravatar: ProviderState<{
    hash: string;
    avatarUrl: string;
    displayName: string | null;
    profileUrl: string | null;
  }>;
  breaches: ProviderState<{
    items: { name: string; domain: string | null; breachDate: string | null; dataClasses: string[] }[];
    source: string;
  }>;
}

type BreachItem = { name: string; domain: string | null; breachDate: string | null; dataClasses: string[] };

function md5(input: string): string {
  return crypto.createHash("md5").update(input).digest("hex");
}

// Gravatar is free and keyless — the avatar endpoint (?d=404 makes it
// 404 instead of returning a generated placeholder) tells us whether an
// account exists at all, and the .json profile endpoint gives a display
// name when the user made their profile public. Real data either way,
// not a guess.
async function lookupGravatar(email: string): Promise<EmailLookupResult["gravatar"]> {
  const hash = md5(email.trim().toLowerCase());
  try {
    const avatarRes = await fetch(`https://www.gravatar.com/avatar/${hash}?d=404`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (avatarRes.status === 404) return { status: "not_found", provider: "Gravatar" };
    if (!avatarRes.ok) return { status: "error", provider: "Gravatar", message: `HTTP ${avatarRes.status}` };

    let displayName: string | null = null;
    let profileUrl: string | null = null;
    try {
      const profileRes = await fetch(`https://www.gravatar.com/${hash}.json`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        const entry = profile?.entry?.[0];
        displayName = entry?.displayName ?? entry?.name?.formatted ?? null;
        profileUrl = entry?.profileUrl ?? null;
      }
    } catch {
      // The profile JSON is a bonus on top of the avatar check — its
      // absence shouldn't fail the whole Gravatar result.
    }

    return {
      status: "ok",
      data: { hash, avatarUrl: `https://www.gravatar.com/avatar/${hash}`, displayName, profileUrl },
    };
  } catch {
    return { status: "error", provider: "Gravatar", message: "Network error or timeout." };
  }
}

// XposedOrNot — a genuinely free, keyless breach-exposure API (unlike
// HaveIBeenPwned, which retired free per-account lookups in 2019). This
// is the tool's primary, always-available breach source; only breach
// *names* come back from this endpoint, no per-breach date/data-class
// detail.
async function lookupXposedOrNot(
  email: string
): Promise<ProviderState<{ names: string[] }>> {
  try {
    const res = await fetch(`https://api.xposedornot.com/v1/check-email/${encodeURIComponent(email)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) return { status: "not_found", provider: "XposedOrNot" };
    if (!res.ok) return { status: "error", provider: "XposedOrNot", message: `HTTP ${res.status}` };
    const data = await res.json().catch(() => null);
    const names: string[] = Array.isArray(data?.breaches?.[0]) ? data.breaches[0] : [];
    if (names.length === 0) return { status: "not_found", provider: "XposedOrNot" };
    return { status: "ok", data: { names } };
  } catch {
    return { status: "error", provider: "XposedOrNot", message: "Network error or timeout." };
  }
}

// HaveIBeenPwned — richer per-breach detail (date, domain, exposed data
// classes) than XposedOrNot, but needs a paid API key since HIBP retired
// free per-account access in 2019. Purely an optional upgrade layered on
// top of the always-free XposedOrNot result below, not a requirement —
// if HIBP_API_KEY isn't set, this is skipped silently rather than
// blocking the tool with a "needs a key" wall.
async function lookupHibp(email: string, apiKey: string): Promise<ProviderState<{ items: BreachItem[] }>> {
  try {
    const res = await fetch(
      `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
      {
        headers: { "hibp-api-key": apiKey, "user-agent": "jaser-osint-dashboard" },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      }
    );
    if (res.status === 404) return { status: "not_found", provider: "HaveIBeenPwned" };
    if (res.status === 429) return { status: "rate_limited", provider: "HaveIBeenPwned" };
    if (!res.ok) return { status: "error", provider: "HaveIBeenPwned", message: `HTTP ${res.status}` };

    const data = (await res.json()) as any[];
    const items: BreachItem[] = data.map((b) => ({
      name: b.Name as string,
      domain: (b.Domain as string) || null,
      breachDate: (b.BreachDate as string) || null,
      dataClasses: (b.DataClasses as string[]) ?? [],
    }));
    return { status: "ok", data: { items } };
  } catch {
    return { status: "error", provider: "HaveIBeenPwned", message: "Network error or timeout." };
  }
}

async function lookupBreaches(email: string): Promise<EmailLookupResult["breaches"]> {
  const apiKey = process.env.HIBP_API_KEY;
  const [xon, hibp] = await Promise.all([
    lookupXposedOrNot(email),
    apiKey ? lookupHibp(email, apiKey) : Promise.resolve(null),
  ]);

  // Merge by breach name — HIBP's richer entry (if present) wins over
  // XposedOrNot's name-only entry for the same breach.
  const byName = new Map<string, BreachItem>();
  if (xon.status === "ok") {
    for (const name of xon.data.names) byName.set(name.toLowerCase(), { name, domain: null, breachDate: null, dataClasses: [] });
  }
  if (hibp?.status === "ok") {
    for (const item of hibp.data.items) byName.set(item.name.toLowerCase(), item);
  }

  if (byName.size > 0) {
    return {
      status: "ok",
      data: { items: [...byName.values()], source: hibp?.status === "ok" ? "XposedOrNot + HaveIBeenPwned" : "XposedOrNot" },
    };
  }
  if (xon.status === "not_found" || hibp?.status === "not_found") {
    return { status: "not_found", provider: xon.status === "not_found" ? "XposedOrNot" : "HaveIBeenPwned" };
  }
  if (xon.status === "error") return { status: "error", provider: "XposedOrNot", message: xon.message };
  return { status: "not_found", provider: "XposedOrNot" };
}

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email")?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Provide a valid email address." }, { status: 400 });
  }

  const rl = checkRateLimit(`email:${getClientKey(req)}`, 15, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limit reached, try again shortly." }, { status: 429 });
  }

  const cacheKey = `email:${email.toLowerCase()}`;
  const cached = cacheGet<EmailLookupResult>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const [gravatar, breaches] = await Promise.all([lookupGravatar(email), lookupBreaches(email)]);
  const result: EmailLookupResult = { target: email, gravatar, breaches };
  cacheSet(cacheKey, result, TTL.ONE_HOUR);
  return NextResponse.json(result);
}
