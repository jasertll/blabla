// Wikimedia Commons' own public MediaWiki search API — real, free,
// keyless, no rate-limit-killing auth needed for reasonable use.
// `origin=*` is Wikimedia's own documented CORS-enablement parameter
// for anonymous cross-origin requests; this still goes through our own
// server route (not the browser directly) to keep every external
// fetch in one place for logging/rate-limiting consistency with the
// other providers, not because it's required for CORS reasons here.
import type { ProviderState } from "@/lib/osintTypes";
import type { WebResult } from "../types";

const PROVIDER = "wikimedia-commons";
const BASE = "https://commons.wikimedia.org/w/api.php";

type SearchHit = { title: string; snippet?: string; timestamp?: string };

export async function searchWikimediaCommons(query: string, limit = 10): Promise<ProviderState<WebResult[]>> {
  try {
    const params = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: query,
      srnamespace: "6", // File: namespace — media files only, not talk/category pages
      srlimit: String(Math.min(limit, 20)),
      format: "json",
      origin: "*",
    });
    const res = await fetch(`${BASE}?${params.toString()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Jaser-image-intel/1.0 (keyless OSINT tool)" },
    });

    if (!res.ok) return { status: "error", provider: PROVIDER, message: `HTTP ${res.status}` };

    const json = await res.json();
    const hits: SearchHit[] = json?.query?.search ?? [];
    if (hits.length === 0) return { status: "not_found", provider: PROVIDER };

    const retrievalDate = new Date().toISOString();
    const webResults: WebResult[] = hits.map((h) => ({
      provider: PROVIDER,
      sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`,
      domain: "commons.wikimedia.org",
      sourceClass: "IMAGE_HOST",
      title: h.title.replace(/^File:/, ""),
      // Wikimedia's snippet comes back with <span class="searchmatch">
      // highlight markup — strip it to plain text rather than render
      // raw HTML from an external source into the page.
      snippet: h.snippet ? h.snippet.replace(/<\/?span[^>]*>/g, "") : null,
      publicationDate: h.timestamp ?? null,
      retrievalDate,
      matchedTerms: [query],
    }));

    return { status: "ok", data: webResults };
  } catch (err) {
    return { status: "error", provider: PROVIDER, message: err instanceof Error ? err.message : "Network error." };
  }
}
