import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getRedis } from "@/lib/redis";
import { injectCanaryIntoPdf } from "@/lib/canaryPdf";
import type { CanaryTokenMeta } from "@/lib/canaryTypes";

export const runtime = "nodejs";

const MAX_BYTES = 15 * 1024 * 1024;

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
    return NextResponse.json({ error: "missing_file", message: "Attach a PDF first." }, { status: 400 });
  }
  const originalName = file instanceof File ? file.name : "document.pdf";
  // The label only exists to identify the entry in the dashboard — with
  // a real file attached, its own filename is already a perfectly good
  // one, so there's no reason to force typing something in addition.
  const label = rawLabel || originalName.replace(/\.pdf$/i, "") || "Untitled";
  const looksLikePdf = file.type === "application/pdf" || originalName.toLowerCase().endsWith(".pdf");
  if (!looksLikePdf) {
    return NextResponse.json({ error: "not_pdf", message: "Only PDF files are supported." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large", message: "That file is bigger than the 15 MB limit." }, { status: 400 });
  }

  const inputBytes = new Uint8Array(await file.arrayBuffer());
  const token = crypto.randomBytes(16).toString("hex");
  const hitUrl = `${req.nextUrl.origin}/api/canary/hit/${token}`;

  let tracked: Uint8Array;
  try {
    tracked = await injectCanaryIntoPdf(inputBytes, hitUrl);
  } catch {
    return NextResponse.json(
      {
        error: "invalid_pdf",
        message: "Couldn't process that PDF — it may be encrypted, corrupted, or in an unsupported format.",
      },
      { status: 400 }
    );
  }

  const meta: CanaryTokenMeta = { label, createdAt: Date.now(), kind: "pdf-beacon" };
  await redis.hset("jaser:canary:tokens", { [token]: meta });

  const asciiFallback = "document.pdf";
  const utf8Name = `${(label.slice(0, 60).trim() || originalName.replace(/\.pdf$/i, "")).trim()}.pdf`;

  return new NextResponse(new Uint8Array(tracked), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`,
      "X-Canary-Token": token,
    },
  });
}
