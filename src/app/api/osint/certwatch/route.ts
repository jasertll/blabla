import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import { getRedis } from "@/lib/redis";
import { fetchCerts } from "@/lib/certwatch";

export const runtime = "nodejs";

const WATCHLIST_KEY = "jaser:certwatch:domains";
const seenKey = (domain: string) => `jaser:certwatch:seen:${domain}`;

function isValidDomain(d: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(d);
}

export async function GET(req: NextRequest) {
  const domain = (req.nextUrl.searchParams.get("domain") ?? "").trim().toLowerCase();
  if (!domain || !isValidDomain(domain)) {
    return NextResponse.json({ error: "invalid_domain", message: "اكتب دومين صحيح (مثلاً example.com)." }, { status: 400 });
  }

  const rl = checkRateLimit(`certwatch:${getClientKey(req)}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "طلبات كتير بوقت قصير — جرب بعد شوي." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds ?? 30) } }
    );
  }

  try {
    const certs = await fetchCerts(domain);
    const redis = getRedis();
    const watching = redis ? !!(await redis.hget(WATCHLIST_KEY, domain).catch(() => null)) : false;
    return NextResponse.json({ domain, certs: certs.slice(0, 100), truncated: certs.length > 100, watching });
  } catch (e) {
    return NextResponse.json({ error: "fetch_failed", message: (e as Error).message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { error: "not_configured", message: "مراقبة الشهادات تحتاج Redis — أضف UPSTASH_REDIS_REST_URL وUPSTASH_REDIS_REST_TOKEN." },
      { status: 200 }
    );
  }

  const body = await req.json().catch(() => null);
  const domain = String(body?.domain ?? "").trim().toLowerCase();
  const action = body?.action;
  if (!domain || !isValidDomain(domain)) {
    return NextResponse.json({ error: "invalid_domain", message: "دومين غير صحيح." }, { status: 400 });
  }

  if (action === "unwatch") {
    await Promise.all([redis.hdel(WATCHLIST_KEY, domain), redis.del(seenKey(domain))]);
    return NextResponse.json({ ok: true, watching: false });
  }

  if (action === "watch") {
    const rl = checkRateLimit(`certwatch-watch:${getClientKey(req)}`, 10, 60_000);
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited", message: "طلبات كتير — جرب بعد شوي." }, { status: 429 });
    }
    try {
      // Seed the "seen" set with whatever exists right now so watching a
      // domain that already has 40 certs doesn't immediately scream "40
      // new certs" the first time the watchlist is checked — only certs
      // issued *after* this point should ever count as new.
      const certs = await fetchCerts(domain);
      await Promise.all([
        redis.hset(WATCHLIST_KEY, { [domain]: JSON.stringify({ addedAt: Date.now() }) }),
        redis.set(seenKey(domain), JSON.stringify(certs.map((c) => c.id))),
      ]);
      return NextResponse.json({ ok: true, watching: true, seededCount: certs.length });
    } catch (e) {
      return NextResponse.json({ error: "fetch_failed", message: (e as Error).message }, { status: 502 });
    }
  }

  return NextResponse.json({ error: "invalid_action", message: "action لازم يكون watch أو unwatch." }, { status: 400 });
}
