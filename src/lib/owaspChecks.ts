import tls from "node:tls";
import { safeFetch } from "./ssrfGuard";

export type ExposedFileResult = { path: string; exposed: boolean; status: number | null };

const SENSITIVE_PATHS = [
  "/.git/config",
  "/.env",
  "/.env.local",
  "/wp-config.php.bak",
  "/config.php.bak",
  "/.aws/credentials",
  "/.htpasswd",
  "/backup.zip",
  "/.DS_Store",
];

/** Checks a curated list of commonly-sensitive paths for HTTP 200 — a
 * read-only existence check (like a browser requesting the URL), not an
 * exploitation attempt. This is the same passive technique tools like
 * Nikto use for their baseline checks.
 *
 * Uses safeFetch (not plain fetch) since baseUrl's host is whatever the
 * caller passed in verbatim — DNS-pins the connection against the
 * SSRF/rebinding gap a plain fetch would otherwise reopen even after the
 * caller's own upstream host check. */
export async function checkExposedFiles(baseUrl: string): Promise<ExposedFileResult[]> {
  const results = await Promise.all(
    SENSITIVE_PATHS.map(async (path) => {
      try {
        const res = await safeFetch(`${baseUrl}${path}`, {
          method: "GET",
          cache: "no-store",
          signal: AbortSignal.timeout(6000),
          headers: { "User-Agent": "Jaser-passive-scan/1.0" },
        }, 0);
        return { path, exposed: res.status === 200, status: res.status };
      } catch {
        return { path, exposed: false, status: null };
      }
    })
  );
  return results;
}

/** Reads Server / X-Powered-By headers — passive, the server sends these
 * to every visitor already. Flags whether a specific version string is
 * disclosed (useful for an attacker to target known CVEs for that version). */
export function checkVersionDisclosure(headers: Headers): { disclosed: boolean; values: string[] } {
  const values: string[] = [];
  const server = headers.get("server");
  const poweredBy = headers.get("x-powered-by");
  if (server && /\d/.test(server)) values.push(`Server: ${server}`);
  if (poweredBy) values.push(`X-Powered-By: ${poweredBy}`);
  return { disclosed: values.length > 0, values };
}

/** Attempts a TLS handshake and reports the negotiated protocol version.
 * TLS 1.0/1.1 are deprecated (known-weak, e.g. BEAST/POODLE-class issues)
 * — this is read-only, the same handshake a browser performs.
 *
 * `resolvedIp`, when given, is dialed directly instead of re-resolving
 * `hostname` via DNS at connect time — closes the same DNS-rebinding
 * SSRF gap safeFetch's pinned dispatcher closes for the HTTP(S) paths,
 * just via tls.connect's own `host` option instead of undici. SNI
 * (`servername`) and certificate hostname verification still check
 * against the real `hostname`, exactly as before — only *where* the
 * socket connects changes. */
export async function checkTlsProtocol(hostname: string, resolvedIp?: string): Promise<{ weak: boolean; protocol: string | null }> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: resolvedIp ?? hostname, port: 443, servername: hostname, timeout: 5000 }, () => {
      const proto = socket.getProtocol();
      socket.end();
      resolve({ weak: proto === "TLSv1" || proto === "TLSv1.1", protocol: proto });
    });
    socket.on("error", () => resolve({ weak: false, protocol: null }));
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ weak: false, protocol: null });
    });
  });
}

/** Parses the HTML for <script src="..."> tags pointing off-origin without
 * an integrity attribute — a read of the page's own markup, not injection. */
export function checkMissingSri(html: string, origin: string): boolean {
  const scriptTags = [...html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)];
  for (const match of scriptTags) {
    const src = match[1];
    const fullTag = match[0];
    const isExternal = /^https?:\/\//i.test(src) && !src.includes(origin);
    if (isExternal && !/integrity=/i.test(fullTag)) return true;
  }
  return false;
}
