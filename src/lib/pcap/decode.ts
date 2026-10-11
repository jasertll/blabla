/**
 * lib/pcap/decode.ts — decodes one captured frame (Ethernet/raw-IP/Linux
 * cooked capture) down through IPv4/IPv6 to TCP/UDP, extracting just
 * enough to build a conversation list and run a few honest heuristics.
 * Not a full protocol stack — no reassembly, no TLS parsing, no options
 * beyond what's needed for header length — just what a triage pass over
 * a capture actually needs.
 */

export type DecodedPacket = {
  timestamp: number;
  length: number;
  srcIp: string | null;
  dstIp: string | null;
  srcPort: number | null;
  dstPort: number | null;
  protocol: "TCP" | "UDP" | "ICMP" | "ICMPv6" | "ARP" | "Other";
  /** Best-effort application-layer guess, from well-known ports. */
  appProtocol: string | null;
  /** TCP flags byte (SYN=0x02, ACK=0x10, FIN=0x01, RST=0x04, PSH=0x08) — null for non-TCP. */
  tcpFlags: number | null;
  /** A short slice of the payload as ASCII, for heuristics/display — not the full payload. */
  payloadPreview: string;
  payloadBytes: Uint8Array;
};

const LINKTYPE_ETHERNET = 1;
const LINKTYPE_RAW = 101;
const LINKTYPE_LINUX_SLL = 113;

function ipv4ToString(b: Uint8Array, off: number): string {
  return `${b[off]}.${b[off + 1]}.${b[off + 2]}.${b[off + 3]}`;
}

function ipv6ToString(b: Uint8Array, off: number): string {
  const parts: string[] = [];
  for (let i = 0; i < 8; i++) {
    parts.push(((b[off + i * 2] << 8) | b[off + i * 2 + 1]).toString(16));
  }
  return parts.join(":");
}

function asciiPreview(b: Uint8Array, max = 200): string {
  let s = "";
  for (let i = 0; i < Math.min(b.length, max); i++) {
    const c = b[i];
    s += c >= 32 && c < 127 ? String.fromCharCode(c) : ".";
  }
  return s;
}

const APP_PORTS: Record<number, string> = {
  20: "FTP-DATA", 21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS",
  67: "DHCP", 68: "DHCP", 69: "TFTP", 80: "HTTP", 110: "POP3", 123: "NTP",
  135: "MSRPC", 137: "NetBIOS", 138: "NetBIOS", 139: "NetBIOS", 143: "IMAP",
  161: "SNMP", 389: "LDAP", 443: "HTTPS/TLS", 445: "SMB", 465: "SMTPS",
  514: "Syslog", 587: "SMTP", 993: "IMAPS", 995: "POP3S", 1433: "MSSQL",
  1521: "Oracle", 3306: "MySQL", 3389: "RDP", 5432: "PostgreSQL", 5900: "VNC",
  6379: "Redis", 8080: "HTTP-alt", 27017: "MongoDB",
};

function guessAppProtocol(port1: number | null, port2: number | null): string | null {
  if (port1 !== null && APP_PORTS[port1]) return APP_PORTS[port1];
  if (port2 !== null && APP_PORTS[port2]) return APP_PORTS[port2];
  return null;
}

function decodeIp(b: Uint8Array, off: number, timestamp: number, frameLen: number): DecodedPacket | null {
  if (off >= b.length) return null;
  const version = b[off] >> 4;

  if (version === 4) {
    if (off + 20 > b.length) return null;
    const ihl = (b[off] & 0x0f) * 4;
    const protoNum = b[off + 9];
    const srcIp = ipv4ToString(b, off + 12);
    const dstIp = ipv4ToString(b, off + 16);
    return decodeTransport(b, off + ihl, protoNum, srcIp, dstIp, timestamp, frameLen);
  }

  if (version === 6) {
    if (off + 40 > b.length) return null;
    const nextHeader = b[off + 6];
    const srcIp = ipv6ToString(b, off + 8);
    const dstIp = ipv6ToString(b, off + 24);
    return decodeTransport(b, off + 40, nextHeader, srcIp, dstIp, timestamp, frameLen);
  }

  return null;
}

function decodeTransport(
  b: Uint8Array, off: number, protoNum: number, srcIp: string, dstIp: string, timestamp: number, frameLen: number
): DecodedPacket {
  if (protoNum === 6 && off + 20 <= b.length) {
    const srcPort = (b[off] << 8) | b[off + 1];
    const dstPort = (b[off + 2] << 8) | b[off + 3];
    const dataOffset = (b[off + 12] >> 4) * 4;
    const tcpFlags = b[off + 13];
    const payload = b.subarray(off + dataOffset, b.length);
    return {
      timestamp, length: frameLen, srcIp, dstIp, srcPort, dstPort,
      protocol: "TCP", appProtocol: guessAppProtocol(srcPort, dstPort), tcpFlags,
      payloadPreview: asciiPreview(payload), payloadBytes: payload,
    };
  }
  if (protoNum === 17 && off + 8 <= b.length) {
    const srcPort = (b[off] << 8) | b[off + 1];
    const dstPort = (b[off + 2] << 8) | b[off + 3];
    const payload = b.subarray(off + 8, b.length);
    return {
      timestamp, length: frameLen, srcIp, dstIp, srcPort, dstPort,
      protocol: "UDP", appProtocol: guessAppProtocol(srcPort, dstPort), tcpFlags: null,
      payloadPreview: asciiPreview(payload), payloadBytes: payload,
    };
  }
  const isIcmp6 = protoNum === 58;
  return {
    timestamp, length: frameLen, srcIp, dstIp, srcPort: null, dstPort: null,
    protocol: protoNum === 1 ? "ICMP" : isIcmp6 ? "ICMPv6" : "Other",
    appProtocol: null, tcpFlags: null, payloadPreview: "", payloadBytes: new Uint8Array(0),
  };
}

export function decodeFrame(linkType: number, data: Uint8Array, timestamp: number): DecodedPacket | null {
  try {
    if (linkType === LINKTYPE_ETHERNET) {
      if (data.length < 14) return null;
      const etherType = (data[12] << 8) | data[13];
      if (etherType === 0x0800 || etherType === 0x86dd) return decodeIp(data, 14, timestamp, data.length);
      if (etherType === 0x0806) {
        return { timestamp, length: data.length, srcIp: null, dstIp: null, srcPort: null, dstPort: null, protocol: "ARP", appProtocol: null, tcpFlags: null, payloadPreview: "", payloadBytes: new Uint8Array(0) };
      }
      return null;
    }
    if (linkType === LINKTYPE_RAW) {
      return decodeIp(data, 0, timestamp, data.length);
    }
    if (linkType === LINKTYPE_LINUX_SLL) {
      if (data.length < 16) return null;
      const protoType = (data[14] << 8) | data[15];
      if (protoType === 0x0800 || protoType === 0x86dd) return decodeIp(data, 16, timestamp, data.length);
      return null;
    }
    return null;
  } catch {
    return null;
  }
}
