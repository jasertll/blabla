// Passive CORS-misconfiguration probe: sends a normal GET with an Origin
// header naming a clearly unrelated test domain — the same header every
// browser already attaches to a cross-origin request — and reads how the
// server responds. A server that reflects an arbitrary Origin back in
// Access-Control-Allow-Origin AND sets Access-Control-Allow-Credentials:
// true will let any website read this site's authenticated responses on
// a visitor's behalf, a well-documented real misconfiguration class. No
// payload, no state change — a read-only header exchange.

import { safeFetch } from "./ssrfGuard";

const PROBE_ORIGIN = "https://cors-probe.jaser-scan.invalid";

export type CorsAnalysis = {
  tested: boolean;
  reflectsArbitraryOrigin: boolean;
  allowsCredentialsWithReflection: boolean;
  tone: "good" | "warn" | "bad";
  note: string;
};

// Uses safeFetch (not plain fetch) for the same reason checkExposedFiles
// does — `url`'s host is caller-supplied, and DNS-pinning the actual
// connection closes the SSRF/rebinding gap a plain fetch would reopen.
export async function checkCorsMisconfig(url: string): Promise<CorsAnalysis> {
  try {
    const res = await safeFetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
      headers: { Origin: PROBE_ORIGIN, "User-Agent": "Jaser-passive-scan/1.0" },
    }, 0);
    const allowOrigin = res.headers.get("access-control-allow-origin");
    const allowCreds = res.headers.get("access-control-allow-credentials");
    const reflects = allowOrigin === PROBE_ORIGIN || allowOrigin === "*";
    const reflectsArbitrary = allowOrigin === PROBE_ORIGIN; // reflects our made-up origin specifically, not a public "*"
    const allowsCredsWithReflection = reflectsArbitrary && allowCreds?.toLowerCase() === "true";

    let tone: CorsAnalysis["tone"] = "good";
    let note = "No CORS misconfiguration detected — an arbitrary test origin was not granted access.";
    if (allowsCredsWithReflection) {
      tone = "bad";
      note = "Reflects any Origin AND allows credentials — any website can make authenticated requests here on a visitor's behalf and read the response. Serious misconfiguration.";
    } else if (reflectsArbitrary) {
      tone = "warn";
      note = "Reflects an arbitrary Origin back in Access-Control-Allow-Origin (without credentials) — broader than typical intent, worth reviewing which origins actually need access.";
    } else if (allowOrigin === "*") {
      tone = "warn";
      note = "Access-Control-Allow-Origin: * — fine for public, non-authenticated endpoints; a problem if any response here contains user-specific data.";
    }

    return { tested: true, reflectsArbitraryOrigin: reflects, allowsCredentialsWithReflection: allowsCredsWithReflection, tone, note };
  } catch {
    return { tested: false, reflectsArbitraryOrigin: false, allowsCredentialsWithReflection: false, tone: "good", note: "CORS probe could not complete." };
  }
}
