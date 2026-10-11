import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getRedis } from "@/lib/redis";
import { getClientKey } from "@/lib/rateLimit";
import { SITE_AUTH_COOKIE, SITE_AUTH_COOKIE_MAX_AGE, sha256Hex } from "@/lib/sitePassword";

export const runtime = "nodejs";

const MAX_FAILURES = 8;
const LOCKOUT_WINDOW_SECONDS = 15 * 60;
const FAILED_LOG_KEY = "jaser:site-auth:failed-log";
const MAX_LOG_ENTRIES = 50;

// Constant-time comparison — a plain `===` leaks how many leading
// characters matched through response-time differences, which is a real
// (if slow) attack against a single shared password with no per-account
// lockout otherwise available. Hashing first sidesteps timingSafeEqual's
// equal-length requirement, since SHA-256 output is always the same size
// regardless of input length.
async function passwordsMatch(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  return crypto.timingSafeEqual(Buffer.from(ha, "hex"), Buffer.from(hb, "hex"));
}

// Handles the login form proxy.ts renders when SITE_PASSWORD is
// set and the request has no valid auth cookie yet. Kept as a real
// Route Handler rather than the proxy redirecting a POST back to
// itself — a Route Handler is always dynamic on any hosting platform,
// so there's no ambiguity about whether POST is allowed at this path.
export async function POST(req: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword) return NextResponse.redirect(new URL("/", req.url), 303);

  const redis = getRedis();
  const clientKey = getClientKey(req);
  const lockoutKey = `jaser:site-auth:fails:${clientKey}`;

  // Best-effort lockout — if Redis isn't configured, this simply skips
  // the check rather than blocking login entirely (same fail-open
  // pattern the rest of the app uses when Redis is absent).
  if (redis) {
    const failures = (await redis.get<number>(lockoutKey).catch(() => null)) ?? 0;
    if (failures >= MAX_FAILURES) {
      return new NextResponse("Too many attempts — try again later.", {
        status: 429,
        headers: { "Retry-After": String(LOCKOUT_WINDOW_SECONDS) },
      });
    }
  }

  const form = await req.formData().catch(() => null);
  const submitted = form?.get("password");

  if (typeof submitted === "string" && (await passwordsMatch(submitted, sitePassword))) {
    if (redis) await redis.del(lockoutKey).catch(() => {});
    // ?welcome=1 triggers the one-time welcome video (LoginWelcomeVideo) —
    // read once on mount and stripped from the URL immediately, so a
    // refresh or bookmark of this exact link never replays it.
    const res = NextResponse.redirect(new URL("/?welcome=1", req.url), 303);
    res.cookies.set(SITE_AUTH_COOKIE, await sha256Hex(sitePassword), {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax",
      maxAge: SITE_AUTH_COOKIE_MAX_AGE,
      path: "/",
    });
    return res;
  }

  if (redis) {
    await Promise.all([
      redis.incr(lockoutKey),
      redis.expire(lockoutKey, LOCKOUT_WINDOW_SECONDS),
      // Kept separate from the lockout counter above — that one resets
      // constantly (cleared on success, expires after 15 minutes) and
      // is only ever read as a number. This is a standing log so the
      // owner can actually see *that* someone tried and from where,
      // not just get silently rate-limited with no visibility into it.
      redis.rpush(FAILED_LOG_KEY, JSON.stringify({ ip: clientKey, time: Date.now() })),
      redis.ltrim(FAILED_LOG_KEY, -MAX_LOG_ENTRIES, -1),
    ]).catch(() => {});
  }

  return NextResponse.redirect(new URL("/?authError=1", req.url), 303);
}
