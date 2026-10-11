import {
  LayoutDashboard,
  Globe2,
  ShieldCheck,
  Globe,
  Camera,
  UserSearch,
  Mail,
  FileSearch,
  Fingerprint,
  Network,
  Satellite,
  Wand2,
  Radar,
  Coins,
  BookOpen,
  Layers,
  Bird,
  FileStack,
  ShieldAlert,
  Crosshair,
  Waves,
  BadgeCheck,
  Target,
  Eye,
  Bug,
  ScanSearch,
  Compass,
} from "lucide-react";
import type { ToolId } from "@/contexts/InvestigationContext";

export type NavItem = { id: ToolId; label: string; icon: typeof Globe2 };
export type NavGroup = { id: string; label: string; items: NavItem[] };

// Single source of truth for "every tool that exists" — shared by SideNav
// (the persistent rail) and CommandPalette (the ⌘K jump list) so the two
// can never drift out of sync.
export const NAV_GROUPS: NavGroup[] = [
  { id: "command", label: "Command Center", items: [{ id: "overview", label: "Overview", icon: LayoutDashboard }] },
  // Vertical slice of the 2D world layer — see the architecture audit.
  // One room, one interactive terminal, one real tool (IP Analyzer)
  // behind it. A separate group from Command Center so it reads as an
  // experimental alternate entry point, not a replacement for it.
  { id: "world", label: "World (Preview)", items: [{ id: "world", label: "Jaser's World", icon: Compass }] },
  {
    id: "investigate",
    label: "Investigate",
    items: [
      { id: "ip", label: "IP / ASN Analyzer", icon: Globe2 },
      { id: "domain", label: "Domain & URL Scan", icon: ShieldCheck },
      { id: "webapp", label: "Web App Security Scan", icon: Globe },
      { id: "camera", label: "CCTV / IoT Camera Check", icon: Camera },
      { id: "certwatch", label: "Certificate Watch", icon: ShieldAlert },
      { id: "surface", label: "Attack Surface Report", icon: Target },
    ],
  },
  {
    id: "osint",
    label: "OSINT",
    items: [
      { id: "username", label: "Username / Name / Phone", icon: UserSearch },
      { id: "recon", label: "Recon Toolkit", icon: Radar },
      { id: "exposure", label: "Exposure Dashboard", icon: Eye },
    ],
  },
  {
    id: "forensics",
    label: "Forensics",
    items: [
      { id: "email", label: "Email Header Forensics", icon: Mail },
      { id: "file", label: "File / Malware Inspector", icon: FileSearch },
      { id: "stego", label: "Steganography Scanner", icon: Layers },
      { id: "forensics", label: "Digital Forensics Toolkit", icon: Fingerprint },
      { id: "library", label: "Forensics Learning Library", icon: BookOpen },
      { id: "canary", label: "Canary Token Generator", icon: Bird },
      { id: "pdf", label: "PDF Toolkit", icon: FileStack },
      { id: "pcap", label: "PCAP Network Analyzer", icon: Waves },
      { id: "c2pa", label: "Content Credentials (C2PA)", icon: BadgeCheck },
      { id: "yara", label: "YARA Rule Tester", icon: Bug },
      { id: "imageintel", label: "Image Threat Intelligence", icon: ScanSearch },
    ],
  },
  {
    id: "intelligence",
    label: "Intelligence",
    items: [
      { id: "graph", label: "Intelligence Graph", icon: Network },
      { id: "space", label: "Satellite Tracker", icon: Satellite },
      { id: "gold", label: "XAU/USD Decision Engine", icon: Coins },
      { id: "attack", label: "MITRE ATT&CK Mapper", icon: Crosshair },
    ],
  },
  { id: "utilities", label: "Utilities", items: [{ id: "utilities", label: "Utilities", icon: Wand2 }] },
];
