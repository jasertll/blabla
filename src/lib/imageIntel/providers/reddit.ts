// Reddit's official API via OAuth2 client-credentials grant (a "script"
// app registered at reddit.com/prefs/apps) — legitimate, authorized
// access per spec section 15, never scraped. Server-only.
//
// Token caching is best-effort module-scope memory only: a serverless
// function instance may cold-start at any time, in which case this
// simply re-requests a token (Reddit's token endpoint has its own
// separate, generous rate limit from the search API itself, so this
// costs nothing beyond one extra round-trip on a cold start).
import type { ProviderState } from "@/lib/osintTypes";
import type { RedditResult } from "../types";

const PROVIDER = "reddit";
const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";
const USER_AGENT = "web:jaser-image-intel:1.0 (OSINT investigation tool)";

function credentials(): { id: string; secret: string } | null {
  const id = process.env.REDDIT_CLIENT_ID?.trim();
  const secret = process.env.REDDIT_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

export function redditStatus(): "available" | "missing_key" {
  return credentials() ? "available" : "missing_key";
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(id: string, secret: string): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 10_000) return cachedToken.value;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const json = await res.json();
  if (!json.access_token) return null;
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

export async function searchReddit(query: string, limit = 25): Promise<ProviderState<RedditResult[]>> {
  const creds = credentials();
  if (!creds) return { status: "missing_key", provider: PROVIDER, envVar: "REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET" };

  try {
    const token = await getAccessToken(creds.id, creds.secret);
    if (!token) return { status: "error", provider: PROVIDER, message: "Authentication rejected — check REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET." };

    const url = `${API_BASE}/search?q=${encodeURIComponent(query)}&sort=relevance&limit=${Math.min(limit, 100)}&raw_json=1`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 429) return { status: "rate_limited", provider: PROVIDER };
    if (!res.ok) return { status: "error", provider: PROVIDER, message: `HTTP ${res.status}` };

    const json = await res.json();
    const children: any[] = json?.data?.children ?? [];
    if (children.length === 0) return { status: "not_found", provider: PROVIDER };

    const retrievalTime = new Date().toISOString();
    const results: RedditResult[] = children.map((c) => {
      const d = c.data ?? {};
      return {
        redditPostId: d.id ?? "",
        subreddit: d.subreddit ?? "",
        author: d.author ?? null,
        title: d.title ?? "",
        bodySnippet: typeof d.selftext === "string" && d.selftext.length > 0 ? d.selftext.slice(0, 300) : null,
        createdAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : "",
        permalink: d.permalink ? `https://reddit.com${d.permalink}` : "",
        matchedTerms: [query],
        provider: "reddit",
        retrievalTime,
      };
    });

    return { status: "ok", data: results };
  } catch (err) {
    return { status: "error", provider: PROVIDER, message: err instanceof Error ? err.message : "Network error." };
  }
}
