// TinEye commercial reverse-image-search API (api.tineye.com) — one
// interchangeable implementation of the ReverseImageProvider interface
// (see ../providerTypes.ts). Nothing else imports api.tineye.com
// directly. Server-only: TINEYE_API_KEY must never reach the client.
//
// Current auth (TinEye migrated off HMAC-signature auth): a single
// `x-api-key` header carrying the account's API key. Search accepts
// either a direct image upload (multipart) or an image URL; this
// adapter uses direct upload since the investigated image never has a
// public URL of its own.
import type { ProviderState } from "@/lib/osintTypes";
import type { ReverseImageMatch } from "../types";

const BASE = "https://api.tineye.com/rest";
const PROVIDER = "TinEye";

function apiKey(): string | null {
  const key = process.env.TINEYE_API_KEY;
  return key && key.trim().length > 0 ? key.trim() : null;
}

export function tineyeStatus(): "available" | "missing_key" {
  return apiKey() ? "available" : "missing_key";
}

type TineyeRawMatch = {
  image_url?: string;
  domain?: string;
  score?: number;
  crawl_date?: string;
  backlinks?: { url?: string; backlink?: string; crawl_date?: string }[];
};

export async function searchByImageBytes(bytes: Uint8Array, fileName: string, mimeType: string): Promise<ProviderState<ReverseImageMatch[]>> {
  const key = apiKey();
  if (!key) return { status: "missing_key", provider: PROVIDER, envVar: "TINEYE_API_KEY" };

  try {
    const form = new FormData();
    // Cast: Uint8Array's `buffer` is typed ArrayBufferLike (which also
    // covers SharedArrayBuffer) but BlobPart requires a concrete
    // ArrayBuffer — always true at runtime for bytes read via
    // arrayBuffer()/FileReader in this codebase, never SharedArrayBuffer.
    form.append("image", new Blob([bytes as BlobPart], { type: mimeType }), fileName || "image");

    const res = await fetch(`${BASE}/search/`, {
      method: "POST",
      headers: { "x-api-key": key },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });

    if (res.status === 401 || res.status === 403) {
      return { status: "error", provider: PROVIDER, message: "Authentication rejected — check TINEYE_API_KEY." };
    }
    if (res.status === 429) {
      return { status: "rate_limited", provider: PROVIDER };
    }
    if (!res.ok) {
      return { status: "error", provider: PROVIDER, message: `HTTP ${res.status}` };
    }

    const json = await res.json();
    const results: TineyeRawMatch[] = json?.result ?? json?.results ?? [];
    if (!Array.isArray(results) || results.length === 0) {
      return { status: "not_found", provider: PROVIDER };
    }

    const retrievalDate = new Date().toISOString();
    const matches: ReverseImageMatch[] = results.map((r) => {
      const backlink = r.backlinks?.[0];
      const resultUrl = backlink?.url ?? backlink?.backlink ?? r.image_url ?? "";
      let domain = r.domain ?? "";
      if (!domain && resultUrl) {
        try {
          domain = new URL(resultUrl).hostname;
        } catch {
          domain = "";
        }
      }
      return {
        provider: PROVIDER,
        resultUrl,
        canonicalUrl: resultUrl,
        domain,
        title: null,
        snippet: null,
        matchedImageUrl: r.image_url ?? null,
        publicationDate: backlink?.crawl_date ?? r.crawl_date ?? null,
        retrievalDate,
        // TinEye's own result set is exact/cropped/edited-copy matches by
        // design (it is not a general visual-similarity search) — see
        // spec section 12: never relabel an ordinary similarity hit as a
        // TinEye match. A provider-returned score close to 100 reads as
        // "exact"; anything looser is reported as "edited" rather than
        // asserting a specific transform TinEye itself doesn't tell us.
        matchType: (r.score ?? 0) >= 99 ? "exact" : "edited",
        providerScore: typeof r.score === "number" ? r.score : null,
      };
    });

    return { status: "ok", data: matches };
  } catch (err) {
    return { status: "error", provider: PROVIDER, message: err instanceof Error ? err.message : "Network error." };
  }
}
