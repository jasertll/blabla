// Openverse (openverse.org) — a real, free, public API indexing
// openly-licensed images (Creative Commons) across Flickr, Wikimedia
// Commons, museums, and other sources. No API key required for
// reasonable, non-bulk use (an optional OAuth client exists only for
// higher rate limits). Searches by TEXT (OCR-derived terms, detected
// object classes), not by image upload — a real, structured,
// keyless complement to the reverse-image-search link-launchers in
// searchLinks.ts.
import type { ProviderState } from "@/lib/osintTypes";
import type { WebResult } from "../types";

const PROVIDER = "openverse";
const BASE = "https://api.openverse.org/v1/images/";

type OpenverseResult = {
  title?: string;
  creator?: string;
  foreign_landing_url?: string;
  url?: string;
  source?: string;
  license?: string;
};

export async function searchOpenverse(query: string, pageSize = 10): Promise<ProviderState<WebResult[]>> {
  try {
    const params = new URLSearchParams({ q: query, page_size: String(Math.min(pageSize, 20)) });
    const res = await fetch(`${BASE}?${params.toString()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Jaser-image-intel/1.0 (keyless OSINT tool)" },
    });

    if (res.status === 429) return { status: "rate_limited", provider: PROVIDER };
    if (!res.ok) return { status: "error", provider: PROVIDER, message: `HTTP ${res.status}` };

    const json = await res.json();
    const results: OpenverseResult[] = json?.results ?? [];
    if (results.length === 0) return { status: "not_found", provider: PROVIDER };

    const retrievalDate = new Date().toISOString();
    const webResults: WebResult[] = results.map((r) => {
      const sourceUrl = r.foreign_landing_url ?? r.url ?? "";
      let domain = r.source ?? "";
      if (!domain && sourceUrl) {
        try {
          domain = new URL(sourceUrl).hostname;
        } catch {
          domain = "";
        }
      }
      return {
        provider: PROVIDER,
        sourceUrl,
        domain,
        sourceClass: "IMAGE_HOST",
        title: r.title ?? null,
        snippet: r.creator ? `By ${r.creator}${r.license ? ` — ${r.license.toUpperCase()}` : ""}` : null,
        publicationDate: null,
        retrievalDate,
        matchedTerms: [query],
      };
    });

    return { status: "ok", data: webResults };
  } catch (err) {
    return { status: "error", provider: PROVIDER, message: err instanceof Error ? err.message : "Network error." };
  }
}
