import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { logCanaryHit } from "@/lib/canaryHit";
import type { StoredCanaryFile } from "@/lib/canaryFile";

export const runtime = "nodejs";

// See app/api/canary/link/route.ts for the full explanation. This is
// the URL that link gives out — every GET here is logged first (same
// shared logCanaryHit() the PDF beacon uses, so both mechanisms show
// up identically in the dashboard), then the stored file is served
// back with an "inline" disposition so it opens/displays directly
// rather than forcing a save dialog.
//
// The optional [[...filename]] segment after the token is purely
// cosmetic — /api/canary/link appends the real filename there
// (e.g. .../view/<token>/Payroll-Report-2026.pdf) so the raw URL
// itself reads like a normal document link at a glance, which matters
// wherever only plain text can be shared (SMS, WhatsApp) and an <a>
// tag with friendly display text isn't an option. It's never read
// here — `token` alone is still the only thing that determines which
// file comes back, so nothing about the response depends on what (if
// anything) follows it in the path.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string; filename?: string[] }> }) {
  const { token } = await params;
  const redis = getRedis();
  if (!redis) {
    return new NextResponse("This link isn't active — the site owner hasn't configured tracking storage.", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const stored = await redis.get<StoredCanaryFile>(`jaser:canary:file:${token}`);
  if (!stored) {
    return new NextResponse("This link is no longer valid.", { status: 404, headers: { "Content-Type": "text/plain" } });
  }

  // Log first — even if something about serving the file goes wrong
  // below, the open itself has already been recorded.
  await logCanaryHit(redis, req, token);

  const bytes = Buffer.from(stored.data, "base64");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": stored.contentType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(stored.filename)}"`,
      "Cache-Control": "no-store",
    },
  });
}
