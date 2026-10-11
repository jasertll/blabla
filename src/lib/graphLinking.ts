import type { GraphNodeData, GraphEdgeData } from "./intelligenceGraph";

type SignalKind = "ip" | "domain" | "org" | "cert" | "wifi_ssid" | "username";
type Signal = { kind: SignalKind; value: string };

function push(signals: Signal[], kind: SignalKind, value: string | null | undefined) {
  if (!value) return;
  const v = value.trim().toLowerCase().replace(/\.$/, "");
  if (!v) return;
  signals.push({ kind, value: v });
}

// Every comparable identifier a node carries — its own identity (type +
// label) plus anything pulled from the raw scan payload attached at
// pin-time — so two nodes pinned from *different* tools (e.g. a Domain
// scan and an IP scan, or an Email lookup and a Domain scan) that turn
// out to share an IP, domain, org/ASN, cert issuer, or WiFi network name
// get auto-linked instead of sitting on the graph as disconnected dots.
export function extractSignals(node: GraphNodeData): Signal[] {
  const signals: Signal[] = [];
  const raw = node.raw;

  switch (node.type) {
    case "domain":
    case "subdomain":
      push(signals, "domain", node.label);
      break;
    case "ip":
      push(signals, "ip", node.label);
      break;
    case "asn":
      push(signals, "org", node.label.replace(/^AS\d+\s*/, ""));
      break;
    case "certificate":
      if (!/^favicon hash/i.test(node.label)) push(signals, "cert", node.label);
      break;
    case "email":
      push(signals, "domain", node.label.split("@")[1]);
      push(signals, "username", node.label.split("@")[0]);
      break;
    case "username":
      push(signals, "username", node.label);
      break;
  }

  if (raw && typeof raw === "object") {
    // Domain-scan payload shape (buildGraphFromDomainScan)
    for (const ip of raw.dns?.a ?? []) push(signals, "ip", ip);
    if (raw.ssl?.status === "ok" && raw.ssl.data?.issuer) push(signals, "cert", raw.ssl.data.issuer);
    if (raw.subdomains?.status === "ok") {
      for (const sub of raw.subdomains.data?.items ?? []) push(signals, "domain", sub);
    }

    // IP-scan payload shape (buildGraphFromIpScan)
    if (raw.asn?.status === "ok" && raw.asn.data?.holder) push(signals, "org", raw.asn.data.holder);
    if (raw.geo?.status === "ok" && raw.geo.data?.isp) push(signals, "org", raw.geo.data.isp);
    if (raw.rdap?.status === "ok" && raw.rdap.data?.name) push(signals, "org", raw.rdap.data.name);
    if (raw.reverseDns?.status === "ok") {
      for (const host of raw.reverseDns.data?.hostnames ?? []) push(signals, "domain", host);
    }

    // Email-lookup payload shape (EmailLookupResult)
    if (raw.breaches?.status === "ok") {
      for (const item of raw.breaches.data?.items ?? []) push(signals, "domain", item.domain);
    }
    if (typeof raw.target === "string" && raw.target.includes("@")) {
      push(signals, "domain", raw.target.split("@")[1]);
    }

    // WiFi SSID-search payload (tags a pinned BSSID with the network name
    // it was found under, so two access points broadcasting the same SSID
    // auto-link even though their BSSIDs are different).
    if (typeof raw.ssid === "string") push(signals, "wifi_ssid", raw.ssid);
  }

  return signals;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

// Compares every newly-pinned node against every node already on the graph
// (including the other new ones) and produces a RELATED_TO edge for any
// pair that shares a signal, skipping pairs an explicit edge (from a
// tool's own buildGraphFrom*) already connects — this is what turns
// separate scans into one connected picture instead of a pile of
// disconnected dots the user has to link by hand.
export function inferEdges(
  newNodes: GraphNodeData[],
  allNodes: GraphNodeData[],
  existingEdges: GraphEdgeData[]
): GraphEdgeData[] {
  const connectedPairs = new Set(existingEdges.map((e) => pairKey(e.source, e.target)));
  const signalCache = new Map<string, Signal[]>();
  const signalsOf = (n: GraphNodeData) => {
    let s = signalCache.get(n.id);
    if (!s) {
      s = extractSignals(n);
      signalCache.set(n.id, s);
    }
    return s;
  };

  const edges: GraphEdgeData[] = [];
  const seenPairs = new Set<string>();

  for (const n of newNodes) {
    const nSignals = signalsOf(n);
    if (nSignals.length === 0) continue;

    for (const other of allNodes) {
      if (other.id === n.id) continue;
      const key = pairKey(n.id, other.id);
      if (connectedPairs.has(key) || seenPairs.has(key)) continue;

      const oSignals = signalsOf(other);
      const shared = nSignals.some((s) => oSignals.some((o) => o.kind === s.kind && o.value === s.value));
      if (!shared) continue;

      seenPairs.add(key);
      edges.push({ id: `auto:${key}`, source: other.id, target: n.id, relationship: "RELATED_TO" });
    }
  }

  return edges;
}
