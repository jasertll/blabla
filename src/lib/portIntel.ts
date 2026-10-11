// Real, curated (not exhaustive) port → service → risk-context mapping.
// Attack-technique associations are the same kind of well-documented
// pairing MITRE's own technique pages describe (e.g. T1021's own page
// lists RDP/SSH/VNC/SMB by name) — not invented for this app.

export type PortRisk = "info" | "notable" | "elevated";

export type PortProfile = {
  service: string;
  risk: PortRisk;
  note: string;
  attackTechniqueId?: string;
};

const PORT_TABLE: Record<number, PortProfile> = {
  21: { service: "FTP", risk: "elevated", note: "Often unencrypted — credentials and data travel in cleartext.", attackTechniqueId: "T1071" },
  22: { service: "SSH", risk: "notable", note: "Remote shell access — a very common brute-force/credential-stuffing target.", attackTechniqueId: "T1021" },
  23: { service: "Telnet", risk: "elevated", note: "Unencrypted remote access — credentials travel in cleartext; effectively obsolete for anything internet-facing.", attackTechniqueId: "T1021" },
  25: { service: "SMTP", risk: "info", note: "Mail transfer — open relays can be abused for spam.", attackTechniqueId: "T1071" },
  53: { service: "DNS", risk: "info", note: "Name resolution — can also be abused as a covert data-exfiltration channel (DNS tunneling).", attackTechniqueId: "T1071" },
  80: { service: "HTTP", risk: "info", note: "Unencrypted web — part of the normal web-app attack surface.", attackTechniqueId: "T1190" },
  110: { service: "POP3", risk: "notable", note: "Mail retrieval, often unencrypted." },
  135: { service: "MSRPC", risk: "elevated", note: "Windows RPC endpoint mapper — historically a vector for remote-code-execution worms." },
  139: { service: "NetBIOS", risk: "elevated", note: "Legacy Windows file/printer sharing — a classic lateral-movement surface.", attackTechniqueId: "T1021" },
  143: { service: "IMAP", risk: "notable", note: "Mail retrieval, often unencrypted." },
  443: { service: "HTTPS", risk: "info", note: "Encrypted web — part of the normal web-app attack surface.", attackTechniqueId: "T1190" },
  445: { service: "SMB", risk: "elevated", note: "Windows file sharing — the single most common ransomware/worm lateral-movement port (EternalBlue and successors).", attackTechniqueId: "T1021" },
  1433: { service: "MSSQL", risk: "elevated", note: "Database directly reachable from the internet — a common target for credential-stuffing and RCE exploit chains.", attackTechniqueId: "T1210" },
  1521: { service: "Oracle DB", risk: "elevated", note: "Database directly reachable from the internet.", attackTechniqueId: "T1210" },
  2049: { service: "NFS", risk: "elevated", note: "Network file share — misconfiguration commonly exposes arbitrary file access.", attackTechniqueId: "T1005" },
  3306: { service: "MySQL", risk: "elevated", note: "Database directly reachable from the internet — a common target for credential-stuffing and RCE exploit chains.", attackTechniqueId: "T1210" },
  3389: { service: "RDP", risk: "elevated", note: "Windows Remote Desktop — one of the most common initial-access vectors for ransomware operators.", attackTechniqueId: "T1021" },
  5432: { service: "PostgreSQL", risk: "elevated", note: "Database directly reachable from the internet.", attackTechniqueId: "T1210" },
  5900: { service: "VNC", risk: "elevated", note: "Remote desktop — frequently deployed with weak or no authentication.", attackTechniqueId: "T1021" },
  6379: { service: "Redis", risk: "elevated", note: "In-memory data store — historically deployed with no authentication by default, a real RCE vector when internet-facing.", attackTechniqueId: "T1190" },
  8080: { service: "HTTP (alt)", risk: "notable", note: "Common alternate web/admin-panel port.", attackTechniqueId: "T1190" },
  8443: { service: "HTTPS (alt)", risk: "notable", note: "Common alternate web/admin-panel port.", attackTechniqueId: "T1190" },
  9200: { service: "Elasticsearch", risk: "elevated", note: "Search/data engine — historically deployed with no authentication by default; internet-facing instances are routinely mass-scanned and wiped by opportunistic attackers.", attackTechniqueId: "T1005" },
  11211: { service: "Memcached", risk: "elevated", note: "In-memory cache — an internet-facing instance can be abused as a massive DDoS reflection/amplification vector.", attackTechniqueId: "T1498" },
  27017: { service: "MongoDB", risk: "elevated", note: "Database — historically deployed with no authentication by default; a very common source of mass data-exposure incidents.", attackTechniqueId: "T1005" },
};

export function lookupPort(port: number): PortProfile {
  return PORT_TABLE[port] ?? { service: `Port ${port}`, risk: "info", note: "No specific profile for this port in this app's curated table." };
}
