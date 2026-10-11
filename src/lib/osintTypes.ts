export type ProviderState<T> =
  | { status: "ok"; data: T }
  | { status: "missing_key"; provider: string; envVar: string }
  | { status: "rate_limited"; provider: string; retryAfterSeconds?: number }
  | { status: "not_found"; provider: string }
  | { status: "error"; provider: string; message: string };

export interface IpLookupResult {
  target: string;
  internetdb: ProviderState<{
    ports: number[];
    hostnames: string[];
    cpes: string[];
    tags: string[];
    vulns: string[];
  }>;
  geo: ProviderState<{
    country: string | null;
    city: string | null;
    lat: number | null;
    lon: number | null;
    isp: string | null;
    org: string | null;
    isProxy: boolean;
    isHosting: boolean;
    isMobile: boolean;
  }>;
  tor: ProviderState<{ isTorExitNode: boolean }>;
  reverseDns: ProviderState<{ hostnames: string[] }>;
  blacklist: ProviderState<{ listed: boolean; lists: string[] }>;
  asn: ProviderState<{
    asn: number | null;
    holder: string | null;
    description: string | null;
    countryCode: string | null;
    prefix: string | null;
    allocationDate: string | null;
    rir: string | null;
  }>;
  rdap: ProviderState<{
    handle: string | null;
    name: string | null;
    country: string | null;
    startAddress: string | null;
    endAddress: string | null;
    cidr: string | null;
    org: string | null;
    parentHandle: string | null;
  }>;
}

export interface DomainLookupResult {
  target: string;
  dns: {
    a: string[];
    aaaa: string[];
    mx: { exchange: string; priority: number }[];
    ns: string[];
    txt: string[][];
    cname: string[];
  };
  security: {
    spf: string | null;
    dmarc: string | null;
    dkimNote: string;
  };
  whois: ProviderState<{
    registrar: string | null;
    createdDate: string | null;
    expiresDate: string | null;
    nameservers: string[];
  }>;
  ssl: ProviderState<{
    issuer: string;
    subject: string;
    validFrom: string;
    validTo: string;
    daysUntilExpiry: number;
  }>;
  caa: ProviderState<{ records: { critical: number; tag: string; value: string }[] }>;
  soa: ProviderState<{
    nsname: string;
    hostmaster: string;
    serial: number;
    refresh: number;
    retry: number;
    expire: number;
    minttl: number;
  }>;
  dnssec: ProviderState<{ signed: boolean; validated: boolean }>;
  subdomains: ProviderState<{ count: number; items: string[]; truncated: boolean }>;
}

export interface HashLookupResult {
  target: string;
  // CIRCL hashlookup answers "is this a known-good/known file?" (NSRL and
  // similar allowlists) — it is NOT a malware verdict. A "not found" result
  // means the hash isn't in the known-good set; it says nothing about
  // whether the file is malicious.
  circlHashlookup: ProviderState<{
    fileName: string | null;
    product: string | null;
    trustLevel: number | null;
  }>;
}
