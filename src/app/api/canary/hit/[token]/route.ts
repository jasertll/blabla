import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { logCanaryHit } from "@/lib/canaryHit";

export const runtime = "nodejs";

// This is the endpoint the generated/injected PDF's JavaScript calls the
// instant it's opened in Adobe Acrobat/Reader — see lib/canaryPdf.ts for
// the full explanation of that mechanism and its limits (Acrobat only —
// see /api/canary/view/[token] for the universal, any-device, any-file-
// type alternative). Every hit is logged (never blocked), and the
// response is deliberately bland — whoever opened the file has no
// reason to notice anything happened.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const redis = getRedis();
  if (redis) await logCanaryHit(redis, req, token);
  return new NextResponse("", { status: 200, headers: { "Content-Type": "text/plain" } });
}
