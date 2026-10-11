import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";

// Serves back an image staged via POST /api/imageintel/stage — this is
// the URL handed to external reverse-image-search engines. Deliberately
// public/unauthenticated (the token itself, 20 random bytes, is the
// only access control — same model as the Canary Token view links),
// since external search engines have no way to present our site
// password cookie. See proxy.ts's matcher: this path must stay excluded
// from the site-password gate for exactly that reason.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const redis = getRedis();
  if (!redis) {
    return new NextResponse("Not configured.", { status: 503 });
  }

  const stored = await redis.get<{ data: string; contentType: string }>(`jaser:imageintel:staged:${token}`);
  if (!stored) {
    return new NextResponse("This staged image has expired or doesn't exist.", { status: 404 });
  }

  const bytes = Buffer.from(stored.data, "base64");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": stored.contentType,
      "Cache-Control": "no-store",
    },
  });
}
