import { Redis } from "@upstash/redis";

let client: Redis | null = null;
let attempted = false;

/**
 * Lazily creates the Upstash Redis client from env vars. Returns null
 * (never throws) if UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 * aren't set — callers must handle the "not configured" case, same
 * pattern as the missing-API-key states elsewhere in this app.
 */
export function getRedis(): Redis | null {
  if (attempted) return client;
  attempted = true;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  client = new Redis({ url, token });
  return client;
}
