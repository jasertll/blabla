import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import { searchByImageBytes, tineyeStatus } from "@/lib/imageIntel/providers/tineye";

export const runtime = "nodejs";

// TinEye needs the actual image bytes (reverse-image search, not a text
// query) — this is the only imageintel route that receives the image
// itself; Reddit/X search on OCR-derived text only (see their routes).
export async function POST(req: NextRequest) {
  const rateLimit = checkRateLimit(`imageintel-reverse:${getClientKey(req)}`, 10, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Rate limit reached. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 30) } });
  }

  if (tineyeStatus() === "missing_key") {
    return NextResponse.json({ status: "missing_key", provider: "TinEye", envVar: "TINEYE_API_KEY" });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing image in form data." }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "Image too large for reverse-search upload (20MB limit)." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileName = file instanceof File ? file.name : "image";
  const result = await searchByImageBytes(bytes, fileName, file.type || "image/jpeg");
  return NextResponse.json(result);
}
