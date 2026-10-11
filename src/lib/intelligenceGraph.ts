export type GraphNodeType = "domain" | "ip" | "asn" | "certificate" | "subdomain" | "email" | "wifi" | "file" | "username";

export type GraphNodeData = {
  id: string;
  type: GraphNodeType;
  label: string;
  detail?: string;
  raw?: any;
};

export type GraphEdgeData = {
  id: string;
  source: string;
  target: string;
  relationship: "RESOLVES_TO" | "BELONGS_TO" | "USES_CERTIFICATE" | "RELATED_TO";
};

export function buildGraphFromDomainScan(domain: string, data: any): { nodes: GraphNodeData[]; edges: GraphEdgeData[] } {
  const nodes: GraphNodeData[] = [];
  const edges: GraphEdgeData[] = [];

  const domainId = `domain:${domain}`;
  nodes.push({ id: domainId, type: "domain", label: domain, raw: data });

  for (const ip of data.dns?.a ?? []) {
    const ipId = `ip:${ip}`;
    nodes.push({ id: ipId, type: "ip", label: ip });
    edges.push({ id: `${domainId}->${ipId}`, source: domainId, target: ipId, relationship: "RESOLVES_TO" });
  }

  if (data.ssl?.status === "ok") {
    const certId = `cert:${data.ssl.data.issuer}`;
    nodes.push({ id: certId, type: "certificate", label: data.ssl.data.issuer, detail: `Expires ${new Date(data.ssl.data.validTo).toLocaleDateString()}` });
    edges.push({ id: `${domainId}->${certId}`, source: domainId, target: certId, relationship: "USES_CERTIFICATE" });
  }

  if (data.subdomains?.status === "ok") {
    for (const sub of data.subdomains.data.items.slice(0, 12)) {
      if (sub === domain) continue;
      const subId = `subdomain:${sub}`;
      nodes.push({ id: subId, type: "subdomain", label: sub });
      edges.push({ id: `${domainId}->${subId}`, source: domainId, target: subId, relationship: "RELATED_TO" });
    }
  }

  return { nodes, edges };
}

export function buildGraphFromIpScan(ip: string, data: any): { nodes: GraphNodeData[]; edges: GraphEdgeData[] } {
  const nodes: GraphNodeData[] = [];
  const edges: GraphEdgeData[] = [];

  const ipId = `ip:${ip}`;
  nodes.push({ id: ipId, type: "ip", label: ip, raw: data });

  // Prefer BGPView's ASN holder (the actual routing-registry org, with a
  // real AS number) over ip-api.com's ISP field when both are available —
  // it's the more authoritative "who owns this address space" answer.
  if (data.asn?.status === "ok" && data.asn.data.holder) {
    const orgId = `org:AS${data.asn.data.asn ?? data.asn.data.holder}`;
    nodes.push({
      id: orgId,
      type: "asn",
      label: `AS${data.asn.data.asn ?? "?"} ${data.asn.data.holder}`,
      detail: data.asn.data.prefix ?? data.asn.data.countryCode ?? undefined,
    });
    edges.push({ id: `${ipId}->${orgId}`, source: ipId, target: orgId, relationship: "BELONGS_TO" });
  } else if (data.geo?.status === "ok" && data.geo.data.isp) {
    const orgId = `org:${data.geo.data.isp}`;
    nodes.push({ id: orgId, type: "asn", label: data.geo.data.isp, detail: data.geo.data.country ?? undefined });
    edges.push({ id: `${ipId}->${orgId}`, source: ipId, target: orgId, relationship: "BELONGS_TO" });
  }

  return { nodes, edges };
}

export function buildGraphFromWebAppScan(domain: string, data: any): { nodes: GraphNodeData[]; edges: GraphEdgeData[] } {
  const nodes: GraphNodeData[] = [];
  const edges: GraphEdgeData[] = [];

  const domainId = `domain:${domain}`;
  nodes.push({ id: domainId, type: "domain", label: domain });

  for (const sub of (data.subdomains?.list ?? []).slice(0, 15)) {
    const subId = `subdomain:${sub}`;
    nodes.push({ id: subId, type: "subdomain", label: sub });
    edges.push({ id: `${domainId}->${subId}`, source: domainId, target: subId, relationship: "RELATED_TO" });
  }

  return { nodes, edges };
}
