// Shared crt.sh lookup used by both the certwatch check route and the
// watchlist route. Not a route.ts file, so it can freely export helpers —
// Next.js route modules may only export GET/POST/etc. and a small fixed
// set of config fields.

export type CertRecord = {
  id: number;
  issuer: string;
  commonName: string;
  notBefore: string;
  notAfter: string;
  names: string[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// crt.sh's backend (a shared PostgreSQL instance behind a public web
// frontend) is notorious for transient 502/503s under its own load —
// not something on our end, and often gone on the very next request a
// second later. A couple of quick retries turns most of those into a
// clean result instead of a dead end on the first blip.
async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
        headers: { Accept: "application/json" },
      });
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        lastErr = new Error(`crt.sh HTTP ${res.status}`);
        if (i < attempts - 1) await sleep(500 * 2 ** i);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(500 * 2 ** i);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("crt.sh request failed.");
}

// crt.sh mirrors Certificate Transparency logs — every publicly-trusted
// TLS cert ever issued for a domain (or *.domain) shows up here, usually
// within minutes of issuance. That makes it the earliest keyless signal
// available for "someone just stood up infrastructure using my domain
// name" — a lookalike subdomain for phishing, a forgotten dev box, or a
// legitimate cert your own team issued and you just want visibility on.
export async function fetchCerts(domain: string): Promise<CertRecord[]> {
  const res = await fetchWithRetry(`https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`);
  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(
      res.status === 502 || res.status === 503
        ? `crt.sh HTTP ${res.status} — the service itself is overloaded right now (this happens to crt.sh often, independent of this app), try again in a moment.`
        : `crt.sh HTTP ${res.status}`
    );
  }

  const text = await res.text();
  let rows: Array<{ id: number; issuer_name?: string; common_name?: string; not_before?: string; not_after?: string; name_value?: string }>;
  try {
    rows = JSON.parse(text);
  } catch {
    throw new Error("crt.sh returned an unexpected response — try again in a moment.");
  }

  // crt.sh returns one row per (cert, log) pair, so the same cert id can
  // repeat several times (once per CT log it was submitted to) — collapse
  // to one entry per unique cert id before returning.
  const byId = new Map<number, CertRecord>();
  for (const r of rows) {
    if (byId.has(r.id)) continue;
    const names = Array.from(
      new Set((r.name_value ?? "").split("\n").map((n) => n.trim().toLowerCase()).filter(Boolean))
    );
    byId.set(r.id, {
      id: r.id,
      issuer: r.issuer_name ?? "غير معروف",
      commonName: r.common_name ?? "",
      notBefore: r.not_before ?? "",
      notAfter: r.not_after ?? "",
      names,
    });
  }
  return Array.from(byId.values()).sort((a, b) => (a.notBefore < b.notBefore ? 1 : -1));
}
