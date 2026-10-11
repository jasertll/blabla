import dns from "node:dns/promises";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit, type Response as UndiciResponse } from "undici";
import { isPrivateOrReservedIp } from "./ipRanges";

export { isPrivateOrReservedIp };

export type HostValidation =
  | { safe: true; resolvedIp: string; family: 4 | 6 }
  | { safe: false; reason: string };

/**
 * Resolves a hostname and validates the result isn't a private/internal
 * address before any route uses it to make an outbound HTTP/TLS request.
 * Blocks the classic SSRF pattern of pointing a "domain" at localhost or
 * a cloud metadata IP.
 *
 * On its own this only protects a *single* connection made to the exact
 * IP returned here — see safeFetch() below for why resolving once isn't
 * the whole story for an actual HTTP request.
 */
export async function validateHostForOutboundRequest(hostname: string): Promise<HostValidation> {
  const lower = hostname.toLowerCase().trim();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower === "0.0.0.0") {
    return { safe: false, reason: "Target resolves to localhost." };
  }

  try {
    const { address, family } = await dns.lookup(lower);
    if (isPrivateOrReservedIp(address)) {
      return { safe: false, reason: `Target resolves to a private/reserved IP (${address}) — blocked to prevent SSRF.` };
    }
    return { safe: true, resolvedIp: address, family: family as 4 | 6 };
  } catch {
    return { safe: false, reason: "Could not resolve this hostname." };
  }
}

/**
 * Builds an undici dispatcher that pins every connection through it to
 * exactly `ip`, regardless of what hostname a request through it names.
 *
 * Why this matters: validateHostForOutboundRequest() above resolves DNS
 * *once* to check safety, but a plain `fetch(url)` afterwards resolves
 * DNS *again*, completely independently, when it actually opens the
 * connection. A DNS server under attacker control (anything for a
 * domain they own) can simply answer differently on the second lookup —
 * a safe public IP for the check, then 127.0.0.1 or a cloud metadata
 * address moments later for the real connection ("DNS rebinding",
 * TOCTOU). Routing the actual request through this dispatcher closes
 * that gap: the hostname is still sent as SNI/Host (so TLS cert
 * validation and virtual hosting both still work correctly), but no
 * second DNS lookup ever happens — the connection can only ever reach
 * the one IP that was already checked.
 */
export function createPinnedDispatcher(ip: string, family: 4 | 6): Agent {
  return new Agent({
    connect: {
      // Matches Node's own dns.lookup callback convention exactly —
      // confirmed against undici's own internal connector (lib/core/
      // connect.js), which implements this identical IP-pinning pattern
      // and branches on `options.all` the same way. Getting this wrong
      // silently breaks every request through the dispatcher rather
      // than just the safety property, so it's handled exactly like the
      // reference implementation rather than guessed at.
      lookup: (_hostname, options, callback) => {
        if (options.all) {
          callback(null, [{ address: ip, family }]);
        } else {
          callback(null, ip, family);
        }
      },
    },
  });
}

export class SsrfBlockedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SsrfBlockedError";
  }
}

/**
 * A drop-in replacement for `fetch()` that's actually safe to use
 * against a user-supplied URL: validates and DNS-pins every hop,
 * including redirects.
 *
 * Pinning the initial connection isn't sufficient by itself either — a
 * target that passes validation can still respond with a 3xx pointing
 * at an internal address (e.g. "http://169.254.169.254/"), and a plain
 * `fetch(url, { redirect: "follow" })` would transparently follow it
 * with zero re-validation, skipping the guard entirely. This always
 * fetches with `redirect: "manual"` internally and, on a redirect
 * response, re-runs the full validate-then-pin check against the
 * *actual* redirect target before following it — exactly like "follow"
 * from the caller's point of view, just safe at every hop instead of
 * only the first one.
 */
export async function safeFetch(url: string, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  let currentUrl = url;

  for (let hop = 0; ; hop++) {
    const hostname = new URL(currentUrl).hostname;
    const hostCheck = await validateHostForOutboundRequest(hostname);
    if (!hostCheck.safe) throw new SsrfBlockedError(hostCheck.reason);

    const dispatcher = createPinnedDispatcher(hostCheck.resolvedIp, hostCheck.family);
    // Uses undici's own `fetch` internally deliberately, not the ambient
    // global one — Node's built-in global fetch runs on whatever undici
    // version is bundled with that Node release (6.x as of Node 22),
    // while `Agent` here comes from this project's own pinned `undici`
    // dependency (8.x). Passing an Agent from one undici major version
    // as the `dispatcher` for a *different* major version's fetch breaks
    // with an internal "invalid onRequestStart method" error — confirmed
    // directly, not assumed. Cast at the boundary: undici's Response is
    // spec-compliant (same runtime interface as the global one, just a
    // separately-declared TS type), so safeFetch's own public signature
    // stays a genuine drop-in for fetch() — callers never need to know
    // undici's types exist.
    const res = (await undiciFetch(currentUrl, {
      ...(init as UndiciRequestInit),
      redirect: "manual",
      dispatcher,
    })) as unknown as Response;

    const isRedirect = res.status >= 300 && res.status < 400;
    const location = res.headers.get("location");
    if (!isRedirect || !location) return res;

    if (hop >= maxRedirects) {
      throw new SsrfBlockedError(`Too many redirects (stopped after ${maxRedirects}).`);
    }
    currentUrl = new URL(location, currentUrl).toString();
  }
}
