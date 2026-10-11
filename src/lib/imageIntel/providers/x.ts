// X (Twitter) API v2 recent-search endpoint — app-only Bearer-token
// auth, the standard server-to-server auth mode for search. Server-
// only: X_BEARER_TOKEN must never reach the client. X's API access
// tiers are paid and comparatively expensive (see the final report's
// cost notes) — this adapter is implemented for real but, like TinEye
// and Reddit, has no key configured in this environment to test live
// against.
import type { ProviderState } from "@/lib/osintTypes";
import type { XResult } from "../types";

const PROVIDER = "x";
const API_BASE = "https://api.twitter.com/2";

function bearerToken(): string | null {
  const t = process.env.X_BEARER_TOKEN;
  return t && t.trim().length > 0 ? t.trim() : null;
}

export function xStatus(): "available" | "missing_key" {
  return bearerToken() ? "available" : "missing_key";
}

export async function searchX(query: string, maxResults = 25): Promise<ProviderState<XResult[]>> {
  const token = bearerToken();
  if (!token) return { status: "missing_key", provider: PROVIDER, envVar: "X_BEARER_TOKEN" };

  try {
    const params = new URLSearchParams({
      query,
      "tweet.fields": "created_at,author_id,entities",
      "max_results": String(Math.min(Math.max(maxResults, 10), 100)),
      expansions: "author_id",
      "user.fields": "username",
    });
    const res = await fetch(`${API_BASE}/tweets/search/recent?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 401 || res.status === 403) {
      return { status: "error", provider: PROVIDER, message: "Authentication rejected — check X_BEARER_TOKEN and API access tier." };
    }
    if (res.status === 429) return { status: "rate_limited", provider: PROVIDER };
    if (!res.ok) return { status: "error", provider: PROVIDER, message: `HTTP ${res.status}` };

    const json = await res.json();
    const tweets: any[] = json?.data ?? [];
    if (tweets.length === 0) return { status: "not_found", provider: PROVIDER };

    const usersById = new Map<string, string>();
    for (const u of json?.includes?.users ?? []) usersById.set(u.id, u.username);

    const retrievalTime = new Date().toISOString();
    const results: XResult[] = tweets.map((t) => {
      const handle = usersById.get(t.author_id) ?? null;
      return {
        postId: t.id,
        authorHandle: handle,
        createdAt: t.created_at ?? "",
        postUrl: handle ? `https://x.com/${handle}/status/${t.id}` : `https://x.com/i/status/${t.id}`,
        text: t.text ?? "",
        mediaRefs: (t.entities?.urls ?? []).map((u: any) => u.expanded_url).filter(Boolean),
        matchedTerms: [query],
        provider: "x",
        retrievalTime,
      };
    });

    return { status: "ok", data: results };
  } catch (err) {
    return { status: "error", provider: PROVIDER, message: err instanceof Error ? err.message : "Network error." };
  }
}
