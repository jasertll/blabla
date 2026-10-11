import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import { cacheGet, cacheSet, TTL } from "@/lib/cache";

export const runtime = "nodejs";

// Full name / company name OSINT. Fundamentally different problem from
// username OSINT: there's no path like /username to check for existence,
// and no free keyless API does general people-search across social
// platforms (that's exactly the kind of thing paid data-broker APIs sell).
// So almost every result here is a correctly-built SEARCH link, not a
// verified match — always "unknown"/"heuristic", same honest meaning as
// the amber nodes already used for bot-walled username platforms. The one
// exception is OpenCorporates: a real, free, keyless company-registry
// search API — genuine "found"/"not_found" with real registration data.
type CheckStatus = "found" | "not_found" | "unknown";
type Confidence = "reliable" | "heuristic";
type PlatformResult = { platform: string; url: string; status: CheckStatus; confidence: Confidence; note?: string };

function searchLink(platform: string, url: string): PlatformResult {
  return { platform, url, status: "unknown", confidence: "heuristic" };
}

async function openCorporatesCheck(name: string): Promise<PlatformResult> {
  const displayUrl = `https://opencorporates.com/companies?q=${encodeURIComponent(name)}`;
  try {
    const res = await fetch(
      `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(name)}&per_page=5`,
      { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } }
    );
    if (res.status === 429 || res.status === 403) {
      return {
        platform: "OpenCorporates",
        url: displayUrl,
        status: "unknown",
        confidence: "reliable",
        note: "OpenCorporates' anonymous-tier rate limit is tight — try the link directly if this keeps happening.",
      };
    }
    if (!res.ok) return { platform: "OpenCorporates", url: displayUrl, status: "unknown", confidence: "reliable" };

    const json = await res.json();
    const companies: any[] = json?.results?.companies ?? [];
    if (companies.length === 0) return { platform: "OpenCorporates", url: displayUrl, status: "not_found", confidence: "reliable" };

    const summary = companies
      .slice(0, 3)
      .map((c) => `${c.company?.name ?? "?"} - ${c.company?.jurisdiction_code ?? "?"}, ${c.company?.current_status ?? "status unknown"}`)
      .join(" | ");
    return {
      platform: "OpenCorporates",
      url: displayUrl,
      status: "found",
      confidence: "reliable",
      note: `${json?.results?.total_count ?? companies.length} match(es) in the public company registry. Top: ${summary}`,
    };
  } catch {
    return { platform: "OpenCorporates", url: displayUrl, status: "unknown", confidence: "reliable" };
  }
}

// Wikipedia/Wikidata cover a huge share of real people and companies
// worth investigating (public figures, notable businesses) and — unlike
// every social-platform link above — hand back real structured facts:
// a description line and a summary extract, not just "here's a link".
// Two calls: the search API to find the best-matching article (no exact
// title needed), then the REST summary API for the actual content.
async function wikipediaCheck(name: string): Promise<PlatformResult> {
  const displayUrl = `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(name)}`;
  try {
    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&srlimit=1`,
      { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } }
    );
    if (!searchRes.ok) return { platform: "Wikipedia", url: displayUrl, status: "unknown", confidence: "reliable" };
    const searchJson = await searchRes.json();
    const hits: any[] = searchJson?.query?.search ?? [];
    if (hits.length === 0) return { platform: "Wikipedia", url: displayUrl, status: "not_found", confidence: "reliable" };

    const title = hits[0].title as string;
    const summaryRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!summaryRes.ok) {
      return {
        platform: "Wikipedia",
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
        status: "found",
        confidence: "reliable",
        note: `Article found: "${title}" (couldn't load the summary).`,
      };
    }
    const summary = await summaryRes.json();
    const desc = summary.description ? ` - ${summary.description}` : "";
    const note = `${summary.title}${desc}: ${summary.extract ?? ""}`;
    return {
      platform: "Wikipedia",
      url: summary.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      status: "found",
      confidence: "reliable",
      note: note.length > 400 ? `${note.slice(0, 400)}...` : note,
    };
  } catch {
    return { platform: "Wikipedia", url: displayUrl, status: "unknown", confidence: "reliable" };
  }
}

// A genuine keyless check (not just a link) — GitHub's public search API
// works without auth, just at a much lower rate limit (10 req/min vs the
// 30/min this route allows overall), handled via the normal
// ProviderState-style degrade instead of crashing or lying about a match.
async function githubSearchCheck(name: string): Promise<PlatformResult> {
  const displayUrl = `https://github.com/search?q=${encodeURIComponent(name)}&type=users`;
  try {
    const res = await fetch(`https://api.github.com/search/users?q=${encodeURIComponent(name)}&per_page=5`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/vnd.github+json" },
    });
    if (res.status === 403 || res.status === 429) {
      return {
        platform: "GitHub",
        url: displayUrl,
        status: "unknown",
        confidence: "reliable",
        note: "GitHub's unauthenticated search rate limit is very low (10/min) - try the link directly if this keeps happening.",
      };
    }
    if (!res.ok) return { platform: "GitHub", url: displayUrl, status: "unknown", confidence: "reliable" };

    const json = await res.json();
    const items: any[] = json.items ?? [];
    if (items.length === 0) return { platform: "GitHub", url: displayUrl, status: "not_found", confidence: "reliable" };

    const summary = items.slice(0, 5).map((u) => `${u.login} (${u.type})`).join(", ");
    return {
      platform: "GitHub",
      url: displayUrl,
      status: "found",
      confidence: "reliable",
      note: `${json.total_count ?? items.length} match(es): ${summary}`,
    };
  } catch {
    return { platform: "GitHub", url: displayUrl, status: "unknown", confidence: "reliable" };
  }
}

function isPrintableName(name: string): boolean {
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code < 32 || code === 127;
    if (isControl) return false;
  }
  return true;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("target") ?? "";
  const name = raw.trim().replace(/\s+/g, " ");

  if (!name) {
    return NextResponse.json({ error: "Missing ?target=<name>" }, { status: 400 });
  }
  if (name.length > 100) {
    return NextResponse.json({ error: "Name too long (max 100 chars)." }, { status: 400 });
  }
  // Anything goes for a real name/company (accents, Arabic script, '&',
  // apostrophes, etc.) - every use below goes through encodeURIComponent
  // into a query string, never a path segment, so there's no injection
  // surface. Only reject control characters.
  if (!isPrintableName(name)) {
    return NextResponse.json({ error: "Invalid characters in name." }, { status: 400 });
  }

  const rateLimit = checkRateLimit(`name:${getClientKey(req)}`, 15, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit reached. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 30) } }
    );
  }

  const cacheKey = `name:${name.toLowerCase()}`;
  const cached = cacheGet<{ target: string; results: PlatformResult[] }>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const q = encodeURIComponent(name);
  const [openCorporates, wikipedia, github] = await Promise.all([
    openCorporatesCheck(name),
    wikipediaCheck(name),
    githubSearchCheck(name),
  ]);
  const results: PlatformResult[] = [
    openCorporates,
    wikipedia,
    github,
    searchLink("LinkedIn - People", `https://www.linkedin.com/search/results/people/?keywords=${q}`),
    searchLink("LinkedIn - Company", `https://www.linkedin.com/search/results/companies/?keywords=${q}`),
    searchLink("Facebook", `https://www.facebook.com/search/people/?q=${q}`),
    searchLink("Instagram", `https://www.instagram.com/explore/search/keyword/?q=${q}`),
    searchLink("X (Twitter)", `https://twitter.com/search?q=${q}&f=user`),
    searchLink("TikTok", `https://www.tiktok.com/search/user?q=${q}`),
    searchLink("YouTube", `https://www.youtube.com/results?search_query=${q}`),
    searchLink("Google Maps", `https://www.google.com/maps/search/${q}`),
    searchLink("Google Search", `https://www.google.com/search?q=${q}`),
    searchLink("Bing Search", `https://www.bing.com/search?q=${q}`),
  ];

  const result = { target: name, results };
  cacheSet(cacheKey, result, TTL.FIVE_MINUTES);
  return NextResponse.json(result);
}
