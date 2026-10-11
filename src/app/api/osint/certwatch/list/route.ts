import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { fetchCerts, type CertRecord } from "@/lib/certwatch";

export const runtime = "nodejs";

const WATCHLIST_KEY = "jaser:certwatch:domains";
const seenKey = (domain: string) => `jaser:certwatch:seen:${domain}`;

export type WatchedDomainStatus = {
  domain: string;
  addedAt: number;
  newCerts: CertRecord[];
  totalCerts: number;
  error?: string;
};

// Checks every watched domain against crt.sh and diffs against what was
// stored the last time this endpoint ran, then advances the stored
// "seen" set to the current one — so a cert only ever shows up as "new"
// once, on the first check after it was actually issued, the same way
// you'd want a real alert to behave.
export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ configured: false, domains: [] });

  const raw = (await redis.hgetall<Record<string, string>>(WATCHLIST_KEY)) ?? {};
  const domains = Object.keys(raw);

  const results: WatchedDomainStatus[] = await Promise.all(
    domains.map(async (domain): Promise<WatchedDomainStatus> => {
      let addedAt = 0;
      try {
        const meta = typeof raw[domain] === "string" ? JSON.parse(raw[domain]) : raw[domain];
        addedAt = meta?.addedAt ?? 0;
      } catch {
        /* ignore malformed entry */
      }

      try {
        const [certs, seenRaw] = await Promise.all([
          fetchCerts(domain),
          redis.get<string>(seenKey(domain)).catch(() => null),
        ]);
        let seenIds: number[] = [];
        try {
          seenIds = seenRaw ? (typeof seenRaw === "string" ? JSON.parse(seenRaw) : (seenRaw as unknown as number[])) : [];
        } catch {
          seenIds = [];
        }
        const seenSet = new Set(seenIds);
        const newCerts = certs.filter((c) => !seenSet.has(c.id));

        await redis.set(seenKey(domain), JSON.stringify(certs.map((c) => c.id))).catch(() => {});

        return { domain, addedAt, newCerts, totalCerts: certs.length };
      } catch (e) {
        return { domain, addedAt, newCerts: [], totalCerts: 0, error: (e as Error).message };
      }
    })
  );

  results.sort((a, b) => b.addedAt - a.addedAt);
  return NextResponse.json({ configured: true, domains: results });
}
