import { NextRequest, NextResponse } from "next/server";
import dns from "node:dns/promises";
import tls from "node:tls";
import { cacheGet, cacheSet, TTL } from "@/lib/cache";
import type { DomainLookupResult } from "@/lib/osintTypes";
import { isPrivateOrReservedIp } from "@/lib/ssrfGuard";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";

// Needs Node's dns/tls modules — must not run on the Edge runtime.
export const runtime = "nodejs";

async function resolveDns(domain: string): Promise<DomainLookupResult["dns"]> {
  const safe = <T,>(p: Promise<T[]>): Promise<T[]> => p.catch(() => []);

  const [a, aaaa, mx, ns, txt, cname] = await Promise.all([
    safe(dns.resolve4(domain)),
    safe(dns.resolve6(domain)),
    safe(dns.resolveMx(domain)),
    safe(dns.resolveNs(domain)),
    safe(dns.resolveTxt(domain)),
    safe(dns.resolveCname(domain)),
  ]);

  return {
    a,
    aaaa,
    mx: mx.map((m) => ({ exchange: m.exchange, priority: m.priority })),
    ns,
    txt,
    cname,
  };
}

function extractSpfDmarc(txtRecords: string[][], dmarcTxt: string[][]) {
  const flat = txtRecords.map((chunks) => chunks.join(""));
  const spf = flat.find((t) => t.startsWith("v=spf1")) ?? null;
  const dmarcFlat = dmarcTxt.map((chunks) => chunks.join(""));
  const dmarc = dmarcFlat.find((t) => t.startsWith("v=DMARC1")) ?? null;
  return { spf, dmarc };
}

async function lookupWhois(domain: string): Promise<DomainLookupResult["whois"]> {
  try {
    // RDAP: modern, free, structured replacement for legacy WHOIS —
    // no API key, standard across most TLD registries.
    const res = await fetch(`https://rdap.org/domain/${domain}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/rdap+json" },
    });

    if (res.status === 404) return { status: "not_found", provider: "RDAP" };
    if (!res.ok) return { status: "error", provider: "RDAP", message: `HTTP ${res.status}` };

    const data = await res.json();
    const events: { eventAction: string; eventDate: string }[] = data.events ?? [];
    const registration = events.find((e) => e.eventAction === "registration");
    const expiration = events.find((e) => e.eventAction === "expiration");
    const registrarEntity = (data.entities ?? []).find((e: any) =>
      e.roles?.includes("registrar")
    );

    return {
      status: "ok",
      data: {
        registrar: registrarEntity?.vcardArray?.[1]?.find((v: any) => v[0] === "fn")?.[3] ?? null,
        createdDate: registration?.eventDate ?? null,
        expiresDate: expiration?.eventDate ?? null,
        nameservers: (data.nameservers ?? []).map((n: any) => n.ldhName).filter(Boolean),
      },
    };
  } catch {
    return { status: "error", provider: "RDAP", message: "Network error reaching RDAP." };
  }
}

async function lookupCaa(domain: string): Promise<DomainLookupResult["caa"]> {
  try {
    const records = await dns.resolveCaa(domain);
    if (records.length === 0) return { status: "not_found", provider: "DNS (CAA)" };
    return {
      status: "ok",
      data: {
        records: records.map((r: any) => {
          const { critical, ...rest } = r;
          const [tag, value] = Object.entries(rest)[0] ?? ["unknown", ""];
          return { critical, tag, value: String(value) };
        }),
      },
    };
  } catch (err: any) {
    if (err?.code === "ENODATA" || err?.code === "ENOTFOUND") {
      return { status: "not_found", provider: "DNS (CAA)" };
    }
    return { status: "error", provider: "DNS (CAA)", message: "Lookup failed." };
  }
}

async function lookupSoa(domain: string): Promise<DomainLookupResult["soa"]> {
  try {
    const soa = await dns.resolveSoa(domain);
    return {
      status: "ok",
      data: {
        nsname: soa.nsname,
        hostmaster: soa.hostmaster,
        serial: soa.serial,
        refresh: soa.refresh,
        retry: soa.retry,
        expire: soa.expire,
        minttl: soa.minttl,
      },
    };
  } catch (err: any) {
    if (err?.code === "ENODATA" || err?.code === "ENOTFOUND") {
      return { status: "not_found", provider: "DNS (SOA)" };
    }
    return { status: "error", provider: "DNS (SOA)", message: "Lookup failed." };
  }
}

// DNSSEC has no dedicated Node dns.resolve*() rrtype, so this queries a
// DNS-over-HTTPS resolver directly for DNSKEY. Two independent signals:
// "signed" (a DNSKEY record exists at all) and "validated" (the resolver's
// own AD flag — Authenticated Data — meaning it independently verified the
// chain of DNSSEC signatures, not just that a key is published).
async function checkDnssec(domain: string): Promise<DomainLookupResult["dnssec"]> {
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=DNSKEY`,
      { cache: "no-store", signal: AbortSignal.timeout(6000), headers: { Accept: "application/dns-json" } }
    );
    if (!res.ok) return { status: "error", provider: "Cloudflare DoH", message: `HTTP ${res.status}` };
    const data = await res.json();
    const answers: any[] = data.Answer ?? [];
    return { status: "ok", data: { signed: answers.length > 0, validated: Boolean(data.AD) } };
  } catch {
    return { status: "error", provider: "Cloudflare DoH", message: "Network error." };
  }
}

// crt.sh mirrors Certificate Transparency logs — any publicly-trusted TLS
// cert ever issued for *.domain shows up here, which surfaces subdomains
// that were never linked from anywhere and wouldn't turn up any other way.
async function lookupSubdomains(domain: string): Promise<DomainLookupResult["subdomains"]> {
  try {
    const res = await fetch(`https://crt.sh/?q=${encodeURIComponent("%." + domain)}&output=json`, {
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
      headers: { Accept: "application/json" },
    });
    if (res.status === 404) return { status: "not_found", provider: "crt.sh" };
    if (!res.ok) return { status: "error", provider: "crt.sh", message: `HTTP ${res.status}` };

    const text = await res.text();
    let rows: { name_value?: string }[];
    try {
      rows = JSON.parse(text);
    } catch {
      // crt.sh occasionally returns an empty body or an HTML error page
      // under load instead of JSON — treat that as a soft failure, not a
      // crash.
      return { status: "error", provider: "crt.sh", message: "Unexpected response format." };
    }

    const names = new Set<string>();
    for (const row of rows) {
      for (const raw of (row.name_value ?? "").split("\n")) {
        const name = raw.trim().toLowerCase().replace(/^\*\./, "");
        if (name && name.endsWith(domain)) names.add(name);
      }
    }

    const sorted = Array.from(names).sort();
    const CAP = 60;
    return {
      status: "ok",
      data: { count: sorted.length, items: sorted.slice(0, CAP), truncated: sorted.length > CAP },
    };
  } catch {
    return { status: "error", provider: "crt.sh", message: "Network error or timeout." };
  }
}

async function lookupSsl(domain: string, resolvedIp: string): Promise<DomainLookupResult["ssl"]> {
  return new Promise((resolve) => {
    // Dials the already-resolved, already-validated IP directly instead
    // of letting tls.connect re-resolve `domain` itself — otherwise a
    // domain under attacker control could pass the earlier
    // isPrivateOrReservedIp(resolvedIp) check on its first DNS answer
    // and then answer differently (e.g. 127.0.0.1) on this second,
    // independent resolution moments later ("DNS rebinding"). servername
    // stays `domain` so SNI and certificate hostname verification are
    // unaffected — only *where* the socket connects changes.
    const socket = tls.connect(
      { host: resolvedIp, port: 443, servername: domain, timeout: 5000 },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();

        if (!cert || Object.keys(cert).length === 0) {
          resolve({ status: "not_found", provider: "TLS" });
          return;
        }

        const validTo = new Date(cert.valid_to);
        const daysUntilExpiry = Math.round(
          (validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );

        const toStr = (v: string | string[] | undefined, fallback: string): string =>
          Array.isArray(v) ? v[0] ?? fallback : v ?? fallback;

        resolve({
          status: "ok",
          data: {
            issuer: toStr(cert.issuer?.O ?? cert.issuer?.CN, "Unknown"),
            subject: toStr(cert.subject?.CN, domain),
            validFrom: cert.valid_from,
            validTo: cert.valid_to,
            daysUntilExpiry,
          },
        });
      }
    );

    socket.on("error", (err) => {
      resolve({ status: "error", provider: "TLS", message: err.message });
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ status: "error", provider: "TLS", message: "Connection timed out." });
    });
  });
}

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get("target")?.toLowerCase();
  if (!domain) {
    return NextResponse.json({ error: "Missing ?target=<domain>" }, { status: 400 });
  }

  const rateLimit = checkRateLimit(`domain:${getClientKey(req)}`, 20, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit reached. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 30) } }
    );
  }

  const cacheKey = `domain:${domain}`;
  const cached = cacheGet<DomainLookupResult>(cacheKey);
  if (cached) return NextResponse.json(cached);

  // Resolve DNS first — this is the same lookup already shown to the user,
  // so we reuse its result for the SSRF check instead of a second, separate
  // dns.lookup() call (a redundant query that can behave inconsistently
  // across networks/resolvers and was previously causing false "can't
  // resolve" failures for domains that resolved fine via resolve4/6).
  const [dnsRecords, dmarcTxt, whois, caa, soa, dnssec, subdomains] = await Promise.all([
    resolveDns(domain),
    dns.resolveTxt(`_dmarc.${domain}`).catch(() => [] as string[][]),
    lookupWhois(domain),
    lookupCaa(domain),
    lookupSoa(domain),
    checkDnssec(domain),
    lookupSubdomains(domain),
  ]);

  const resolvedIp = dnsRecords.a[0] ?? dnsRecords.aaaa[0] ?? null;

  // Previously: `isPrivate` defaulted to `false` when resolvedIp was
  // null (no A/AAAA record returned by resolveDns), which let
  // lookupSsl(domain) run anyway — tls.connect would then do its own
  // completely unchecked, independent DNS resolution with zero
  // validation at all, not just the narrower TOCTOU gap pinning closes.
  // Now: no resolved IP means no TLS check, full stop — never an
  // unpinned fallback connection.
  let ssl: DomainLookupResult["ssl"];
  if (!resolvedIp) {
    ssl = { status: "error", provider: "TLS", message: "No A/AAAA record to connect to — TLS check skipped." };
  } else if (isPrivateOrReservedIp(resolvedIp)) {
    ssl = { status: "error", provider: "TLS", message: `Resolved IP (${resolvedIp}) is private/reserved — TLS check skipped to prevent SSRF.` };
  } else {
    ssl = await lookupSsl(domain, resolvedIp);
  }

  const { spf, dmarc } = extractSpfDmarc(dnsRecords.txt, dmarcTxt);

  const result: DomainLookupResult = {
    target: domain,
    dns: dnsRecords,
    security: {
      spf,
      dmarc,
      dkimNote: `DKIM requires knowing the selector used by the domain's mail provider — check a real email's headers for "DKIM-Signature: ... s=<selector>" and query TXT on <selector>._domainkey.${domain}`,
    },
    whois,
    ssl,
    caa,
    soa,
    dnssec,
    subdomains,
  };

  cacheSet(cacheKey, result, TTL.ONE_HOUR);
  return NextResponse.json(result);
}
