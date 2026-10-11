import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getRedis } from "@/lib/redis";
import { buildCanaryPdf } from "@/lib/canaryPdf";
import type { CanaryTokenMeta } from "@/lib/canaryTypes";

export const runtime = "nodejs";

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

  const body = await req.json().catch(() => ({}));
  const label = typeof body?.label === "string" ? body.label.trim().slice(0, 200) : "";
  if (!label) {
    return NextResponse.json({ error: "missing_label", message: "Give the document a label first." }, { status: 400 });
  }

  const token = crypto.randomBytes(16).toString("hex");
  const hitUrl = `${req.nextUrl.origin}/api/canary/hit/${token}`;
  const meta: CanaryTokenMeta = { label, createdAt: Date.now(), kind: "pdf-beacon" };

  await redis.hset("jaser:canary:tokens", { [token]: meta });

  const pdf = buildCanaryPdf({ label, hitUrl });
  const asciiFallback = "document.pdf";
  const utf8Name = `${label.slice(0, 60).trim() || "document"}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`,
      "X-Canary-Token": token,
    },
  });
}
