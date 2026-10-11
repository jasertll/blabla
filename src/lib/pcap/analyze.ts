/**
 * lib/pcap/analyze.ts — turns decoded packets into (a) a conversation
 * list and (b) a short list of concrete, evidence-backed findings. Every
 * finding here points at real bytes from the capture — no speculative
 * "this looks bad" scoring without something to show for it.
 */

import type { DecodedPacket } from "./decode";

export type Conversation = {
  key: string;
  protocol: string;
  a: string; // "ip:port" or "ip"
  b: string;
  packets: number;
  bytes: number;
  firstSeen: number;
  lastSeen: number;
  appProtocol: string | null;
};

export type Finding = {
  severity: "high" | "medium" | "info";
  title: string;
  detail: string;
  evidence: string;
};

export type Credential = {
  protocol: string;
  username: string | null;
  password: string | null;
  endpoint: string;
  timestamp: number;
  evidence: string;
};

function endpoint(ip: string | null, port: number | null): string {
  if (!ip) return "?";
  return port !== null ? `${ip}:${port}` : ip;
}

function connKey(p: DecodedPacket): string {
  if (!p.srcIp || !p.dstIp) return "?";
  const a = endpoint(p.srcIp, p.srcPort);
  const b = endpoint(p.dstIp, p.dstPort);
  const [x, y] = [a, b].sort();
  return `${x}<->${y}`;
}

function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function buildConversations(packets: DecodedPacket[]): Conversation[] {
  const map = new Map<string, Conversation>();
  for (const p of packets) {
    if (!p.srcIp || !p.dstIp) continue;
    const a = endpoint(p.srcIp, p.srcPort);
    const b = endpoint(p.dstIp, p.dstPort);
    // Normalize direction so A->B and B->A land in the same bucket.
    const [x, y] = [a, b].sort();
    const key = `${p.protocol}:${x}<->${y}`;
    const existing = map.get(key);
    if (existing) {
      existing.packets++;
      existing.bytes += p.length;
      existing.firstSeen = Math.min(existing.firstSeen, p.timestamp);
      existing.lastSeen = Math.max(existing.lastSeen, p.timestamp);
      if (!existing.appProtocol && p.appProtocol) existing.appProtocol = p.appProtocol;
    } else {
      map.set(key, {
        key, protocol: p.protocol, a: x, b: y, packets: 1, bytes: p.length,
        firstSeen: p.timestamp, lastSeen: p.timestamp, appProtocol: p.appProtocol,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.bytes - a.bytes);
}

function decodeBase64Safe(s: string): string | null {
  try {
    return typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

/** Parses the QNAME of the first question in a raw DNS payload, if present. */
function parseDnsQueryName(payload: Uint8Array): string | null {
  if (payload.length < 13) return null;
  let i = 12;
  const labels: string[] = [];
  while (i < payload.length) {
    const len = payload[i];
    if (len === 0) break;
    if (len & 0xc0) return null; // compression pointer this early — not a simple query, skip
    i++;
    if (i + len > payload.length) return null;
    labels.push(Array.from(payload.subarray(i, i + len)).map((c) => String.fromCharCode(c)).join(""));
    i += len;
    if (labels.length > 20) break;
  }
  return labels.length ? labels.join(".") : null;
}

/** Reads one BER/DER length field (definite short or long form). */
function readBerLength(b: Uint8Array, i: number): { len: number; next: number } | null {
  const first = b[i];
  if (first === undefined) return null;
  if ((first & 0x80) === 0) return { len: first, next: i + 1 };
  const numBytes = first & 0x7f;
  if (numBytes === 0 || numBytes > 4) return null;
  let len = 0;
  for (let k = 0; k < numBytes; k++) {
    const byte = b[i + 1 + k];
    if (byte === undefined) return null;
    len = (len << 8) | byte;
  }
  return { len, next: i + 1 + numBytes };
}

/**
 * Extracts the community string from an SNMP v1/v2c message: a minimal,
 * bounded BER walk (SEQUENCE > INTEGER version > OCTET STRING community)
 * rather than a loose text guess — SNMP is ASN.1/BER, not text, so a
 * regex over the ASCII preview would miss/mangle it.
 */
function extractSnmpCommunity(payload: Uint8Array): string | null {
  try {
    let i = 0;
    if (payload[i] !== 0x30) return null; // top-level SEQUENCE
    i++;
    const seqLen = readBerLength(payload, i);
    if (!seqLen) return null;
    i = seqLen.next;
    if (payload[i] !== 0x02) return null; // version INTEGER
    i++;
    const verLen = readBerLength(payload, i);
    if (!verLen) return null;
    i = verLen.next + verLen.len;
    if (payload[i] !== 0x04) return null; // community OCTET STRING
    i++;
    const commLen = readBerLength(payload, i);
    if (!commLen || commLen.len === 0 || commLen.len > 64) return null;
    i = commLen.next;
    if (i + commLen.len > payload.length) return null;
    const s = Array.from(payload.subarray(i, i + commLen.len)).map((c) => String.fromCharCode(c)).join("");
    return /^[\x20-\x7e]+$/.test(s) ? s : null;
  } catch {
    return null;
  }
}

/**
 * Pulls actual username/password pairs (not just "a password-looking
 * string appeared somewhere") out of every plaintext auth mechanism this
 * parser recognizes: HTTP Basic/Digest/form logins, FTP and POP3
 * USER/PASS (paired per-connection), IMAP LOGIN, SMTP AUTH PLAIN and the
 * two-step AUTH LOGIN exchange (both base64, decoded and paired via a
 * small per-connection state machine), and SNMP community strings.
 * NTLM/Negotiate handshakes are flagged as present but not decoded — that
 * needs binary NTLMSSP parsing this doesn't attempt, so it isn't claimed.
 */
export function harvestCredentials(packets: DecodedPacket[]): Credential[] {
  const creds: Credential[] = [];
  const seenKeys = new Set<string>();
  const pendingUser = new Map<string, { username: string; protocol: "FTP" | "POP3" }>();
  const pendingSmtpAuthLogin = new Map<string, "await-user" | "await-pass">();
  const pendingSmtpUser = new Map<string, string>();

  function push(protocol: string, username: string | null, password: string | null, p: DecodedPacket, evidence: string) {
    const dedupeKey = `${protocol}|${username}|${password}|${p.srcIp}:${p.srcPort}->${p.dstIp}:${p.dstPort}`;
    if (seenKeys.has(dedupeKey)) return;
    seenKeys.add(dedupeKey);
    creds.push({
      protocol, username, password,
      endpoint: `${endpoint(p.srcIp, p.srcPort)} → ${endpoint(p.dstIp, p.dstPort)}`,
      timestamp: p.timestamp,
      evidence,
    });
  }

  for (const p of packets) {
    if (!p.srcIp || !p.dstIp) continue;
    const key = connKey(p);

    if (p.protocol === "TCP" && p.payloadPreview) {
      const text = p.payloadPreview;

      const basicMatch = text.match(/Authorization:\s*Basic\s+([A-Za-z0-9+/=]+)/i);
      if (basicMatch) {
        const decoded = decodeBase64Safe(basicMatch[1]);
        if (decoded && decoded.includes(":")) {
          const sep = decoded.indexOf(":");
          push("HTTP Basic Auth", decoded.slice(0, sep), decoded.slice(sep + 1), p, `Authorization: Basic ${basicMatch[1].slice(0, 24)}…`);
        }
      }

      const digestMatch = text.match(/Authorization:\s*Digest\s+[^\r\n]*username="([^"]+)"/i);
      if (digestMatch) {
        push("HTTP Digest Auth", digestMatch[1], null, p, `Digest username="${digestMatch[1]}" (password stays hashed, not plaintext)`);
      }

      if (/Authorization:\s*(NTLM|Negotiate)\s+/i.test(text)) {
        push("HTTP NTLM/Negotiate", null, null, p, "NTLM/Negotiate auth handshake observed — binary NTLMSSP, not decoded here.");
      }

      const passField = text.match(/\b(pass(word)?|pwd|passwd)=([^&\s]{1,80})/i);
      if (passField) {
        const userField = text.match(/\b(user(name)?|email|login)=([^&\s]{1,80})/i);
        push(
          "HTTP Form", userField ? safeDecodeURIComponent(userField[3]) : null, safeDecodeURIComponent(passField[3]),
          p, passField[0].slice(0, 60)
        );
      } else {
        const userOnly = text.match(/\b(user(name)?|email|login)=([^&\s]{1,80})/i);
        if (userOnly) push("HTTP Form (username only)", safeDecodeURIComponent(userOnly[3]), null, p, userOnly[0].slice(0, 60));
      }

      if (p.dstPort === 21 || p.srcPort === 21) {
        const userMatch = text.match(/^USER\s+(.+?)\r?$/m);
        if (userMatch) pendingUser.set(key, { username: userMatch[1].trim(), protocol: "FTP" });
        const passMatch = text.match(/^PASS\s+(.+?)\r?$/m);
        if (passMatch) {
          const pending = pendingUser.get(key);
          push("FTP", pending?.protocol === "FTP" ? pending.username : null, passMatch[1].trim(), p, `PASS ${passMatch[1].trim()}`);
        }
      }

      if (p.dstPort === 110 || p.srcPort === 110) {
        const userMatch = text.match(/^USER\s+(.+?)\r?$/m);
        if (userMatch) pendingUser.set(key, { username: userMatch[1].trim(), protocol: "POP3" });
        const passMatch = text.match(/^PASS\s+(.+?)\r?$/m);
        if (passMatch) {
          const pending = pendingUser.get(key);
          push("POP3", pending?.protocol === "POP3" ? pending.username : null, passMatch[1].trim(), p, `PASS ${passMatch[1].trim()}`);
        }
      }

      if (p.dstPort === 143) {
        const loginMatch = text.match(/^\S+\s+LOGIN\s+"?([^"\s]+)"?\s+"?([^"\s]+)"?/im);
        if (loginMatch) push("IMAP", loginMatch[1], loginMatch[2], p, loginMatch[0].slice(0, 60));
      }

      if (p.dstPort === 25 || p.srcPort === 25 || p.dstPort === 587 || p.srcPort === 587) {
        const plainMatch = text.match(/AUTH\s+PLAIN\s+([A-Za-z0-9+/=]+)/i);
        if (plainMatch) {
          const decoded = decodeBase64Safe(plainMatch[1]);
          if (decoded) {
            const parts = decoded.split("\x00");
            if (parts.length >= 3) push("SMTP AUTH PLAIN", parts[1] || parts[0] || null, parts[2], p, "AUTH PLAIN <base64, decoded>");
          }
        }
        if (/^AUTH\s+LOGIN\s*\r?$/im.test(text)) {
          pendingSmtpAuthLogin.set(key, "await-user");
        } else if (pendingSmtpAuthLogin.get(key) === "await-user") {
          const decoded = decodeBase64Safe(text.trim());
          if (decoded && /^[\x20-\x7e]+$/.test(decoded)) {
            pendingSmtpUser.set(key, decoded);
            pendingSmtpAuthLogin.set(key, "await-pass");
          } else {
            pendingSmtpAuthLogin.delete(key);
          }
        } else if (pendingSmtpAuthLogin.get(key) === "await-pass") {
          const decoded = decodeBase64Safe(text.trim());
          if (decoded) push("SMTP AUTH LOGIN", pendingSmtpUser.get(key) ?? null, decoded, p, "AUTH LOGIN (2-step, both base64)");
          pendingSmtpAuthLogin.delete(key);
          pendingSmtpUser.delete(key);
        }
      }
    }

    if (p.protocol === "UDP" && (p.dstPort === 161 || p.srcPort === 161) && p.payloadBytes.length > 0) {
      const community = extractSnmpCommunity(p.payloadBytes);
      if (community) push("SNMP", null, community, p, `community string = "${community}"`);
    }
  }

  return creds.sort((a, b) => a.timestamp - b.timestamp);
}

export function findFindings(packets: DecodedPacket[]): Finding[] {
  const findings: Finding[] = [];
  const seenProtocols = new Set<string>();
  const dnsTunnelCandidates = new Set<string>();
  const synTargets = new Map<string, Set<string>>(); // srcIp -> set of "dstIp:dstPort"

  for (const p of packets) {
    // Cleartext protocol presence — one info finding per protocol, not per packet.
    if (p.appProtocol && ["Telnet", "FTP", "HTTP", "SNMP", "POP3", "IMAP", "SMTP"].includes(p.appProtocol)) {
      seenProtocols.add(p.appProtocol);
    }

    // Very rough SYN-scan heuristic: many distinct destination ports on
    // the same destination IP, from the same source, each a lone SYN. A
    // real scanning SYN carries no payload, so this must not be gated on
    // payloadPreview.
    if (p.protocol === "TCP" && p.tcpFlags === 0x02 && p.srcIp && p.dstIp && p.dstPort !== null) {
      const set = synTargets.get(p.srcIp) ?? new Set<string>();
      set.add(`${p.dstIp}:${p.dstPort}`);
      synTargets.set(p.srcIp, set);
    }

    if (p.protocol === "UDP" && p.dstPort === 53 && p.payloadBytes.length > 0) {
      const name = parseDnsQueryName(p.payloadBytes);
      if (name) {
        const longestLabel = Math.max(...name.split(".").map((l) => l.length));
        if (longestLabel > 45) dnsTunnelCandidates.add(name);
      }
    }
  }

  for (const c of harvestCredentials(packets)) {
    if (c.password === null && c.username === null) continue; // e.g. a bare NTLM handshake sighting
    const who = c.username && c.password ? `${c.username} / ${c.password}` : c.username ? `user "${c.username}"` : `"${c.password}"`;
    findings.push({
      severity: "high",
      title: `Plaintext credentials exposed (${c.protocol})`,
      detail: "Credentials sent in the clear can be read by anyone who can see this traffic (shared Wi-Fi, a compromised switch, an ISP).",
      evidence: `${c.endpoint}: ${who}`,
    });
  }

  for (const proto of seenProtocols) {
    findings.push({
      severity: "medium",
      title: `Unencrypted ${proto} traffic in this capture`,
      detail: `${proto} sends everything — including any credentials — unencrypted. Worth confirming this wasn't carrying anything sensitive.`,
      evidence: `Traffic matching ${proto}'s well-known port was seen in this capture.`,
    });
  }

  for (const name of dnsTunnelCandidates) {
    findings.push({
      severity: "medium",
      title: "Unusually long DNS label — possible tunneling",
      detail: "DNS tunneling tools often encode data into abnormally long subdomain labels to smuggle it out over port 53. This could also just be a legitimate long hostname — worth a second look either way.",
      evidence: name.length > 90 ? name.slice(0, 90) + "…" : name,
    });
  }

  for (const [srcIp, targets] of synTargets) {
    if (targets.size >= 15) {
      findings.push({
        severity: "medium",
        title: `Possible port scan from ${srcIp}`,
        detail: `${srcIp} sent a bare SYN to ${targets.size} distinct host:port combinations with no completed handshake seen for most — the classic signature of a port scan.`,
        evidence: Array.from(targets).slice(0, 8).join(", ") + (targets.size > 8 ? `, +${targets.size - 8} more` : ""),
      });
    }
  }

  const order = { high: 0, medium: 1, info: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}
