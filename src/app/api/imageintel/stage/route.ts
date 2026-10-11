import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getRedis } from "@/lib/redis";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import { sniffSupportedContentType } from "@/lib/canaryFile";

export const runtime = "nodejs";

// Opt-in, short-lived public hosting for one image — the only way any
// external reverse-image-search engine (Yandex/Google Lens/TinEye/Bing)
// can be handed a URL to search by, since none of them accept a direct
// file upload via query parameter. An analyst must explicitly trigger
// this per image/crop (see components/imageIntel/ImageIntelWorkspace.tsx);
// it is never automatic. Deliberately a SEPARATE namespace/endpoint from
// the Canary Token file store — that one is indefinite-until-deleted and
// carries its own hit-tracking semantics, neither of which belong here.
const MAX_BYTES = 8 * 1024 * 1024;
const TTL_SECONDS = 60 * 60; // 1 hour — long enough to run a search, short enough to limit exposure

export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { error: "not_configured", message: "Image staging needs Redis — add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN." },
      { status: 200 }
    );
  }

  const rateLimit = checkRateLimit(`imageintel-stage:${getClientKey(req)}`, 15, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "rate_limited", message: "Rate limit reached. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 30) } });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "missing_file", message: "Attach an image first." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large", message: `Image exceeds the ${MAX_BYTES / 1024 / 1024}MB staging limit.` }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Sniffed from real bytes, never trusting the browser-declared type —
  // same reasoning as the Canary file store (see lib/canaryFile.ts):
  // this gets served back with this exact Content-Type later.
  const contentType = sniffSupportedContentType(bytes);
  if (!contentType) {
    return NextResponse.json({ error: "unsupported_type", message: "Only JPEG/PNG/GIF/WebP/BMP are supported for staging." }, { status: 400 });
  }

  const token = crypto.randomBytes(20).toString("hex");
  await redis.set(
    `jaser:imageintel:staged:${token}`,
    { data: Buffer.from(bytes).toString("base64"), contentType },
    { ex: TTL_SECONDS }
  );

  const url = `${req.nextUrl.origin}/api/imageintel/stage/${token}`;
  return NextResponse.json({ status: "ok", url, token, expiresInSeconds: TTL_SECONDS });
}
