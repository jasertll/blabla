"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import ReactFlow, {
  Handle,
  Position,
  Controls,
  MiniMap,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
} from "reactflow";
import "reactflow/dist/style.css";
import { Network, X, Info } from "lucide-react";
import { useInvestigation } from "@/contexts/InvestigationContext";
import { scoreDomain, scoreIp, TransparentScore } from "@/lib/riskScore";
import type { GraphNodeData } from "@/lib/intelligenceGraph";
import NebulaField from "@/components/NebulaField";

const NODE_COLOR: Record<string, string> = {
  domain: "#f59e0b",
  ip: "#fb7185",
  asn: "#5eead4",
  certificate: "#facc15",
  subdomain: "#c4b5fd",
  email: "#34d399",
  wifi: "#60a5fa",
  file: "#fb923c",
  username: "#e879f9",
};

const HANDLES = (
  <>
    <Handle type="source" position={Position.Top} id="t" style={{ opacity: 0 }} />
    <Handle type="source" position={Position.Right} id="r" style={{ opacity: 0 }} />
    <Handle type="source" position={Position.Bottom} id="b" style={{ opacity: 0 }} />
    <Handle type="source" position={Position.Left} id="l" style={{ opacity: 0 }} />
    <Handle type="target" position={Position.Top} id="tt" style={{ opacity: 0 }} />
    <Handle type="target" position={Position.Right} id="rt" style={{ opacity: 0 }} />
    <Handle type="target" position={Position.Bottom} id="bt" style={{ opacity: 0 }} />
    <Handle type="target" position={Position.Left} id="lt" style={{ opacity: 0 }} />
  </>
);

// Dot + pill-tag node, styled after the reference mood board: a small
// glowing colored node marker with its label in a separate dark
// amber-bordered pill next to it, instead of one big filled box.
function ConstellationNode({ data }: { data: { label: string; color: string; isRoot: boolean } }) {
  const { color, isRoot } = data;
  return (
    <div className="flex items-center gap-1.5 cursor-pointer group">
      {HANDLES}
      <span
        className={`shrink-0 rounded-full transition-transform group-hover:scale-125 ${isRoot ? "h-3.5 w-3.5" : "h-2 w-2"}`}
        style={{ background: color, boxShadow: `0 0 ${isRoot ? 14 : 7}px ${color}` }}
      />
      <span
        className={`font-mono whitespace-nowrap rounded-full border ${isRoot ? "text-[11px] px-2.5 py-1" : "text-[9px] px-1.5 py-0.5"}`}
        style={{ borderColor: `${color}88`, background: "rgba(10,8,20,0.88)", color }}
      >
        {data.label}
      </span>
    </div>
  );
}

const nodeTypes = { constellation: ConstellationNode };

function layoutNodes(nodes: GraphNodeData[], edges: { source: string; target: string }[]): Node[] {
  const columns = ["domain", "ip", "asn", "certificate", "subdomain", "email", "wifi", "file", "username"];
  const colIndex: Record<string, number> = {};
  columns.forEach((c, i) => (colIndex[c] = i));

  const hasIncoming = new Set(edges.map((e) => e.target));
  const perColumnCount: Record<string, number> = {};

  return nodes.map((n) => {
    const col = colIndex[n.type] ?? 0;
    const row = perColumnCount[n.type] ?? 0;
    perColumnCount[n.type] = row + 1;
    const isRoot = !hasIncoming.has(n.id);

    return {
      id: n.id,
      type: "constellation",
      data: { label: n.label, entity: n, color: NODE_COLOR[n.type] ?? "#f59e0b", isRoot },
      position: { x: col * 290, y: row * 60 },
      draggable: true,
    };
  });
}

export default function IntelligenceGraph() {
  const { graphNodes, graphEdges } = useInvestigation();
  const [selected, setSelected] = useState<GraphNodeData | null>(null);
  const [kevMatches, setKevMatches] = useState<string[]>([]);

  // A pinned IP node can carry CVEs — cross-reference against the real,
  // full CISA KEV catalog (same properly-scoped check every other tool
  // uses) whenever a node with vulns is selected, so this panel's score
  // doesn't silently understate risk for a host with an actively-
  // exploited CVE the way a plain CVE-count check would.
  useEffect(() => {
    setKevMatches([]);
    const vulns: string[] = selected?.type === "ip" && selected.raw?.internetdb?.status === "ok" ? selected.raw.internetdb.data.vulns : [];
    if (vulns.length === 0) return;
    fetch(`/api/osint/kevcheck?cves=${encodeURIComponent(vulns.join(","))}`)
      .then((r) => r.json())
      .then((json) => setKevMatches((json.matches ?? []).map((m: { cveID: string }) => m.cveID)))
      .catch(() => setKevMatches([]));
  }, [selected]);

  const layoutedNodes = useMemo(() => layoutNodes(graphNodes, graphEdges), [graphNodes, graphEdges]);
  const nodeColorById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const n of graphNodes) m[n.id] = NODE_COLOR[n.type] ?? "#f59e0b";
    return m;
  }, [graphNodes]);
  const layoutedEdges = useMemo<Edge[]>(
    () =>
      graphEdges.map((e) => {
        const color = nodeColorById[e.source] ?? "#f59e0b";
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: "straight",
          label: e.relationship,
          labelStyle: { fill: "#94a3b8", fontSize: 9 },
          labelBgStyle: { fill: "#0a0814", fillOpacity: 0.8 },
          style: { stroke: color, strokeWidth: 1.2, opacity: 0.55 },
        };
      }),
    [graphEdges, nodeColorById]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // useNodesState/useEdgesState only consume their initial argument once at
  // mount — new scans arriving later (this panel can stay mounted across
  // repeated scans) wouldn't otherwise reach the graph. Push updates in
  // explicitly whenever the computed layout changes.
  useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: any, node: Node) => {
      const entity = graphNodes.find((n) => n.id === node.id) ?? null;
      setSelected(entity);
    },
    [graphNodes]
  );

  let score: TransparentScore | null = null;
  if (selected?.raw) {
    if (selected.type === "domain") score = scoreDomain(selected.raw);
    else if (selected.type === "ip") score = scoreIp(selected.raw, kevMatches);
  }

  return (
    <div className="glass-panel p-4 flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3">
        <Network className="h-4 w-4 text-accent" />
        <h2 className="font-display font-semibold text-sm text-slate-100">Intelligence Graph</h2>
      </div>

      {graphNodes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-slate-500 text-center px-6">
            Pin results from any tool — IP, Domain, Email, WiFi, Username, File Inspector, Email
            Headers, Camera — and they accumulate here. Every real relationship discovered directly
            (resolves-to, certificate issuer, subdomains, hosting org) is shown, and any two pinned
            entries that turn out to share an IP, domain, org, or identity are auto-linked too, even
            across different tools.
          </p>
        </div>
      ) : (
        <div className="flex-1 flex gap-3 min-h-0">
          <div className="relative flex-1 rounded-lg border border-border/60 overflow-hidden bg-[#05040a]">
            <NebulaField />
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              fitView
              fitViewOptions={{ padding: 0.25 }}
              proOptions={{ hideAttribution: true }}
              style={{ background: "transparent" }}
            >
              <Controls className="!bg-[#0d0a18] !border-border [&_button]:!bg-[#0d0a18] [&_button]:!border-border/60 [&_button]:!text-slate-400" />
              <MiniMap nodeColor={(n: any) => n.data?.color ?? "#f59e0b"} maskColor="rgba(5,4,10,0.85)" style={{ background: "#0a0814" }} />
            </ReactFlow>
          </div>

          {selected && (
            <div className="w-72 shrink-0 rounded-lg border border-border bg-panel/60 p-3 overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-200">{selected.label}</p>
                <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-slate-300">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-3">{selected.type}</p>

              {score && (
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-lg font-bold ${score.label === "HIGH" ? "text-red-300" : score.label === "MEDIUM" ? "text-amber-300" : "text-emerald-300"}`}>
                      {score.total}/100
                    </span>
                    <span className="text-[10px] text-slate-500">{score.label} RISK</span>
                  </div>
                  <div className="space-y-1">
                    {score.factors.map((f, i) => (
                      <p key={i} className="text-[11px] text-slate-400">
                        <span className={f.points > 0 ? "text-red-300" : "text-slate-500"}>
                          {f.points > 0 ? `+${f.points}` : "0"}
                        </span>{" "}
                        {f.reason}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {!score && selected.type === "file" && Array.isArray(selected.raw?.verdicts) && (
                <div className="space-y-1.5 mb-2">
                  {selected.raw.verdicts.length === 0 && (
                    <p className="text-[11px] text-emerald-300">No red flags found in this file's checks.</p>
                  )}
                  {selected.raw.verdicts.map((v: any) => (
                    <p key={v.id} className="text-[11px] text-slate-300">
                      <span
                        className={
                          v.severity === "danger" ? "text-red-300" : v.severity === "warning" ? "text-amber-300" : "text-cyan-300"
                        }
                      >
                        [{v.severity.toUpperCase()}]
                      </span>{" "}
                      {v.title}
                    </p>
                  ))}
                  <p className="text-[10px] text-slate-600 font-mono break-all">SHA-256: {selected.raw.sha256}</p>
                </div>
              )}

              {!score && !(selected.type === "file" && selected.raw?.verdicts) && (
                <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
                  <Info className="h-3 w-3 shrink-0 mt-0.5" />
                  No detailed scan data attached to this node yet — it was discovered as a
                  relationship (e.g. a subdomain or certificate issuer) but not scanned directly.
                </p>
              )}

              {selected.detail && <p className="text-[11px] text-slate-400 mt-2">{selected.detail}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
