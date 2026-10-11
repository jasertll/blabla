import type { IpLookupResult } from "./osintTypes";
import { lookupPort, type PortRisk } from "./portIntel";
import { ATTACK_TECHNIQUES } from "./attackData";

export type SurfaceNodeType = "ip" | "asn" | "port" | "cve" | "attack" | "flag";

export type SurfaceNode = {
  id: string;
  type: SurfaceNodeType;
  label: string;
  detail?: string;
  risk?: PortRisk;
  isKev?: boolean;
};

export type SurfaceEdge = { source: string; target: string };

/**
 * A real network attack-surface graph built entirely from this scan's
 * own data — open ports (Shodan InternetDB), the real port→service
 * risk table (lib/portIntel.ts), real CVEs (cross-referenced against
 * CISA's actual KEV catalog, not asserted), and the real ATT&CK
 * techniques those specific exposed services map to. No fabricated
 * telemetry, no invented findings.
 */
export function buildAttackSurfaceGraph(ip: string, data: IpLookupResult, kevMatchedCveIds: string[]): { nodes: SurfaceNode[]; edges: SurfaceEdge[] } {
  const nodes: SurfaceNode[] = [];
  const edges: SurfaceEdge[] = [];
  const seen = new Set<string>();
  function addNode(n: SurfaceNode) {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    nodes.push(n);
  }

  const ipId = "ip";
  addNode({ id: ipId, type: "ip", label: ip });

  if (data.asn?.status === "ok") {
    const id = "asn";
    addNode({ id, type: "asn", label: `AS${data.asn.data.asn ?? "?"}`, detail: data.asn.data.holder ?? undefined });
    edges.push({ source: ipId, target: id });
  }

  if (data.tor?.status === "ok" && data.tor.data.isTorExitNode) {
    const id = "flag-tor";
    addNode({ id, type: "flag", label: "Tor exit node", risk: "elevated" });
    edges.push({ source: ipId, target: id });
  }
  if (data.blacklist?.status === "ok" && data.blacklist.data.listed) {
    const id = "flag-blacklist";
    addNode({ id, type: "flag", label: "Spamhaus listed", risk: "elevated" });
    edges.push({ source: ipId, target: id });
  }
  if (data.geo?.status === "ok" && data.geo.data.isProxy) {
    const id = "flag-proxy";
    addNode({ id, type: "flag", label: "Proxy/anonymizer", risk: "notable" });
    edges.push({ source: ipId, target: id });
  }

  const kevSet = new Set(kevMatchedCveIds.map((c) => c.toUpperCase()));
  const ports: number[] = data.internetdb?.status === "ok" ? data.internetdb.data.ports : [];
  const portIdByNumber = new Map<number, string>();
  for (const p of ports) {
    const profile = lookupPort(p);
    const id = `port-${p}`;
    addNode({ id, type: "port", label: `:${p}`, detail: profile.service, risk: profile.risk });
    edges.push({ source: ipId, target: id });
    portIdByNumber.set(p, id);
  }

  const vulns: string[] = data.internetdb?.status === "ok" ? data.internetdb.data.vulns : [];
  for (const v of vulns) {
    const id = `cve-${v}`;
    addNode({ id, type: "cve", label: v, isKev: kevSet.has(v.toUpperCase()) });
    edges.push({ source: ipId, target: id });
  }

  // ATT&CK techniques, connected FROM the specific exposed port(s) that
  // real, curated table maps them to — never from the IP directly,
  // never invented.
  const techniqueToPorts = new Map<string, number[]>();
  for (const p of ports) {
    const techId = lookupPort(p).attackTechniqueId;
    if (!techId) continue;
    if (!techniqueToPorts.has(techId)) techniqueToPorts.set(techId, []);
    techniqueToPorts.get(techId)!.push(p);
  }
  for (const [techId, portsForTech] of techniqueToPorts) {
    const technique = ATTACK_TECHNIQUES.find((t) => t.id === techId);
    if (!technique) continue;
    const id = `attack-${techId}`;
    addNode({ id, type: "attack", label: technique.id, detail: technique.name });
    for (const p of portsForTech) {
      const portId = portIdByNumber.get(p);
      if (portId) edges.push({ source: portId, target: id });
    }
  }

  return { nodes, edges };
}
