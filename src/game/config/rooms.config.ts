// Registry of every tool in the hospital. Adding a tool = adding an entry here
// (plus a room on a floor layout once that floor is built).

export type FloorId = "1F" | "2F" | "3F" | "4F" | "ROOF" | "B1" | "B2";

export type ToolStatus = "live";

import type { ToolId } from "@/contexts/InvestigationContext";

export interface ToolEntry {
  id: string;
  /** The original tool this room runs (InvestigationContext ToolId). */
  ref: ToolId;
  name: string;
  floor: FloorId;
  room: string;
  category: string;
  /** What the in-world object housing the tool looks like. */
  object: string;
  description: string;
  status: ToolStatus;
}

export const FLOORS: { id: FloorId; name: string; built: boolean }[] = [
  { id: "ROOF", name: "Observatory", built: true },
  { id: "4F", name: "Director's Wing", built: true },
  { id: "3F", name: "Patient Records", built: true },
  { id: "2F", name: "Investigation Ward", built: true },
  { id: "1F", name: "Reception", built: true },
  { id: "B1", name: "Morgue", built: true },
  { id: "B2", name: "Laboratory & Archive", built: true },
];

export const TOOLS: ToolEntry[] = [
  // 1F — Reception
  { id: "overview", ref: "overview", name: "Overview", floor: "1F", room: "Lobby", category: "Command", object: "Wall of CRT monitors + threat hologram", description: "Live threat landscape: CISA KEV and NVD critical CVEs rendered as the ThreatGlobe.", status: "live" },
  { id: "utilities", ref: "utilities", name: "Utilities", floor: "1F", room: "Reception desk", category: "Utilities", object: "Reception drawer", description: "Everyday encoders, decoders and converters.", status: "live" },

  // 2F — Investigation Ward
  { id: "ip-asn", ref: "ip", name: "IP / ASN Analyzer", floor: "2F", room: "201", category: "Investigate", object: "CRT terminal on the desk", description: "Who owns an address, where it lives, and who it talks to.", status: "live" },
  { id: "domain-url", ref: "domain", name: "Domain & URL Scan", floor: "2F", room: "202", category: "Investigate", object: "Typewriter", description: "Dissect a domain or URL: records, redirects, reputation.", status: "live" },
  { id: "webapp-scan", ref: "webapp", name: "Web App Security Scan", floor: "2F", room: "203", category: "Investigate", object: "Surgical lamp over an operating table", description: "Probe a web application for common weaknesses.", status: "live" },
  { id: "cctv-iot", ref: "camera", name: "CCTV / IoT Camera Check", floor: "2F", room: "204", category: "Investigate", object: "Security monitor bank", description: "Check exposed cameras and IoT devices.", status: "live" },
  { id: "cert-watch", ref: "certwatch", name: "Certificate Watch", floor: "2F", room: "205", category: "Investigate", object: "Framed certificates on the wall", description: "Track TLS certificates and their transparency logs.", status: "live" },
  { id: "attack-surface", ref: "surface", name: "Attack Surface Report", floor: "2F", room: "206", category: "Investigate", object: "X-ray light box", description: "Map everything an organisation exposes to the internet.", status: "live" },

  // 3F — Patient Records (OSINT)
  { id: "username", ref: "username", name: "Username / Name / Phone", floor: "3F", room: "301", category: "OSINT", object: "Patient filing cabinet", description: "Trace a person across platforms.", status: "live" },
  { id: "recon", ref: "recon", name: "Recon Toolkit", floor: "3F", room: "302", category: "OSINT", object: "Pinned evidence board", description: "Reconnaissance utilities in one place.", status: "live" },
  { id: "exposure", ref: "exposure", name: "Exposure Dashboard", floor: "3F", room: "303", category: "OSINT", object: "Patient chart clipboard", description: "What about you is already out there.", status: "live" },

  // 4F — Director's Wing (Intelligence)
  { id: "intel-graph", ref: "graph", name: "Intelligence Graph", floor: "4F", room: "401", category: "Intelligence", object: "Corkboard with red string", description: "Link entities into a graph of relationships.", status: "live" },
  { id: "xau-usd", ref: "gold", name: "XAU/USD Decision Engine", floor: "4F", room: "402", category: "Intelligence", object: "Ticker tape machine", description: "Gold vs dollar decision support.", status: "live" },
  { id: "mitre", ref: "attack", name: "MITRE ATT&CK Mapper", floor: "4F", room: "403", category: "Intelligence", object: "Wall-sized anatomy chart", description: "Map behaviour to ATT&CK techniques.", status: "live" },

  // ROOF — Observatory
  { id: "satellite", ref: "space", name: "Satellite Tracker", floor: "ROOF", room: "Observatory", category: "Intelligence", object: "Rusted telescope", description: "Follow satellites overhead in real time.", status: "live" },
  { id: "jasers-world", ref: "world", name: "Jaser's World", floor: "ROOF", room: "???", category: "Secret", object: "Abandoned arcade cabinet", description: "A hidden room. You'll have to find it.", status: "live" },

  // B1 — Morgue (Forensics)
  { id: "email-header", ref: "email", name: "Email Header Forensics", floor: "B1", room: "B101", category: "Forensics", object: "Autopsy table", description: "Read the route an email really took.", status: "live" },
  { id: "malware", ref: "file", name: "File / Malware Inspector", floor: "B1", room: "B102", category: "Forensics", object: "Specimen jar shelf", description: "Inspect a file's guts, including View as DNA.", status: "live" },
  { id: "stego", ref: "stego", name: "Steganography Scanner", floor: "B1", room: "B103", category: "Forensics", object: "Developing darkroom", description: "Find what's hidden inside images.", status: "live" },
  { id: "dfir", ref: "forensics", name: "Digital Forensics Toolkit", floor: "B1", room: "B104", category: "Forensics", object: "Instrument tray", description: "General purpose forensic utilities.", status: "live" },
  { id: "pcap", ref: "pcap", name: "PCAP Network Analyzer", floor: "B1", room: "B105", category: "Forensics", object: "ECG monitor", description: "Read packet captures like a heartbeat.", status: "live" },
  { id: "yara", ref: "yara", name: "YARA Rule Tester", floor: "B1", room: "B106", category: "Forensics", object: "Microscope", description: "Write and test YARA rules.", status: "live" },

  // B2 — Laboratory & Archive
  { id: "library", ref: "library", name: "Forensics Learning Library", floor: "B2", room: "Archive", category: "Forensics", object: "Dusty bookshelves", description: "Learn the craft.", status: "live" },
  { id: "canary", ref: "canary", name: "Canary Token Generator", floor: "B2", room: "B201", category: "Forensics", object: "Birdcage", description: "Plant tripwires that call home.", status: "live" },
  { id: "pdf", ref: "pdf", name: "PDF Toolkit", floor: "B2", room: "B202", category: "Forensics", object: "Printing press", description: "Inspect and manipulate PDFs.", status: "live" },
  { id: "c2pa", ref: "c2pa", name: "Content Credentials (C2PA)", floor: "B2", room: "B203", category: "Forensics", object: "Notary stamp desk", description: "Verify where media came from.", status: "live" },
  { id: "image-intel", ref: "imageintel", name: "Image Threat Intelligence", floor: "B2", room: "B204", category: "Forensics", object: "Photo enlarger", description: "Threat intel from images.", status: "live" },
];

export const toolById = (id: string) => TOOLS.find((t) => t.id === id);
export const toolByRef = (ref: ToolId) => TOOLS.find((t) => t.ref === ref);
