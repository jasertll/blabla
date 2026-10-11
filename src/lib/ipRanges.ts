/**
 * Checks whether an IP falls in a private, loopback, link-local, or
 * otherwise non-public range. Includes 169.254.169.254-class link-local
 * addresses specifically because that range hosts cloud metadata
 * endpoints (AWS/GCP/Azure) — a classic SSRF target for stealing
 * instance credentials.
 *
 * Pure JS, no Node built-ins — safe to import from both server routes
 * and client components (e.g. Email Header Forensics, which parses
 * headers entirely in-browser and needs to tell a real public
 * originating IP apart from an internal relay hop).
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  // IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 0) return true; // 0.0.0.0/8
    if (a >= 224) return true; // multicast/reserved/broadcast
    return false;
  }

  // IPv6
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local fc00::/7
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 — recheck the embedded IPv4 part
    const mapped = lower.split(":").pop() ?? "";
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(mapped)) return isPrivateOrReservedIp(mapped);
  }

  return false;
}
