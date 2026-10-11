type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

/**
 * Fixed-window rate limiter. Good enough for a single-instance deployment
 * (same caveat as lib/cache.ts — swap for Redis if you scale to multiple
 * instances behind a load balancer).
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (bucket.count >= maxRequests) {
    const retryAfterSeconds = Math.ceil((bucket.windowStart + windowMs - now) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  bucket.count += 1;
  return { allowed: true };
}

/**
 * Resolves the real client IP for rate-limit/lockout keys and OSINT
 * geolocation alike. Prefers `req.ip` — populated by Next.js's own
 * request-construction internals on Vercel, not parsed from a header in
 * user-space code — over anything header-based, since a header is
 * exactly the kind of input a client controls directly.
 *
 * This isn't just a privacy/display nuance: every rate limiter in this
 * app, the site-password brute-force lockout, and the visitor counter
 * all key off this value. The previous version took the FIRST entry of
 * X-Forwarded-For, which is backwards — each proxy in a chain appends
 * the hop IT observed to the END of the list, so the first entry is the
 * one closest to the claimed original client, which is exactly the part
 * a client can simply prepend a forged value in front of. A request with
 * header `X-Forwarded-For: 1.2.3.4` (attacker-supplied) arriving through
 * any additional reverse proxy in front of this app would have had that
 * proxy's own observed IP appended as a LATER entry — `split(",")[0]`
 * took the forged one every time, which would have let a single
 * attacker defeat the login lockout and every per-IP rate limit at once
 * just by rotating this one header per request. Falls back to
 * `x-real-ip` (a single value, typically set directly by one trusted
 * reverse proxy) and, only as a last resort, the LAST entry of
 * X-Forwarded-For — the hop closest to this server.
 */
export function getClientKey(req: { ip?: string; headers: Headers }): string {
  if (req.ip) return req.ip;
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return "unknown";
}
