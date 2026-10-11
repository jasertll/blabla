import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getRedis } from "@/lib/redis";
import { MAX_LINK_FILE_BYTES, sniffSupportedContentType, buildCosmeticFilename, type StoredCanaryFile } from "@/lib/canaryFile";
import type { CanaryTokenMeta } from "@/lib/canaryTypes";

export const runtime = "nodejs";

// The universal alternative to the PDF-JavaScript beacon (see
// canaryPdf.ts): instead of relying on a file to run code when opened
// — something only Adobe Acrobat/Reader actually does — this stores
// the file itself and hands back a plain URL. Visiting that URL, on
// *any* device or browser (a phone's default PDF/image viewer included,
// since it's really just a normal web page fetch, no JS execution
// inside a file required), logs the hit server-side and then serves
// the real file back so whoever opened the link still sees the
// document. The one honest tradeoff, spelled out in the UI too: this
// only logs opens of that link — if someone downloads the file through
// it and forwards the raw file onward, further opens of that copy
// aren't tracked (there's no more link involved at that point). Works
// for any supported file type, images included, unlike the PDF-only
// beacon.
export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      {
        error: "not_configured",
        message:
          "Canary tokens need Redis — add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to your environment (same store the gold engine and visitor counter use).",
      },
      { status: 200 }
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const rawLabel = typeof form?.get("label") === "string" ? String(form.get("label")).trim().slice(0, 200) : "";

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "missing_file", message: "Attach a file first." }, { status: 400 });
  }
  const originalName = file instanceof File && file.name ? file.name : "document";
  const label = rawLabel || originalName.replace(/\.[^.]+$/, "") || "Untitled";

  if (file.size > MAX_LINK_FILE_BYTES) {
    return NextResponse.json(
      { error: "too_large", message: `That file is bigger than the ${MAX_LINK_FILE_BYTES / (1024 * 1024)} MB limit for tracked links.` },
      { status: 400 }
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // The Content-Type this file gets served back with (and whether it's
  // accepted at all) is decided from the actual bytes, never from the
  // browser-declared file.type or the filename — see the comment on
  // sniffSupportedContentType for why trusting either of those would
  // let an uploaded file get served back as text/html.
  const contentType = sniffSupportedContentType(bytes);
  if (!contentType) {
    return NextResponse.json(
      { error: "unsupported_type", message: "Supported types: PDF, JPEG, PNG, GIF, WebP, BMP." },
      { status: 400 }
    );
  }

  const token = crypto.randomBytes(16).toString("hex");
  const stored: StoredCanaryFile = {
    data: Buffer.from(bytes).toString("base64"),
    contentType,
    filename: originalName,
  };
  const meta: CanaryTokenMeta = { label, createdAt: Date.now(), kind: "link", filename: originalName };

  await Promise.all([
    redis.set(`jaser:canary:file:${token}`, stored),
    redis.hset("jaser:canary:tokens", { [token]: meta }),
  ]);

  const cosmeticName = buildCosmeticFilename(label, originalName);
  const url = `${req.nextUrl.origin}/api/canary/view/${token}/${encodeURIComponent(cosmeticName)}`;
  return NextResponse.json({ token, url, filename: cosmeticName });
}
