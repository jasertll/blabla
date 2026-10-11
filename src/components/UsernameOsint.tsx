"use client";

import { useState, useMemo, useCallback, useEffect, type ReactNode } from "react";
import { motion } from "framer-motion";
import ReactFlow, { Background, Handle, Position, Node, Edge, useNodesState, useEdgesState } from "reactflow";
import "reactflow/dist/style.css";
import { UserSearch, Loader2, ExternalLink, X, Info, Building2, Phone, Pin, FileDown } from "lucide-react";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { useInvestigation } from "@/contexts/InvestigationContext";
import { buildUsernameReport, openReport } from "@/lib/reportGenerator";

type CheckStatus = "found" | "not_found" | "unknown";
type Confidence = "reliable" | "heuristic";
type PlatformResult = { platform: string; url: string; status: CheckStatus; confidence: Confidence; note?: string };
type Mode = "username" | "name" | "phone";

const MODES: { id: Mode; label: string; icon: typeof UserSearch; placeholder: string }[] = [
  { id: "username", label: "Username", icon: UserSearch, placeholder: "e.g. torvalds" },
  { id: "name", label: "Full Name / Company", icon: Building2, placeholder: "e.g. John Smith or Acme Corp" },
  { id: "phone", label: "Phone Number", icon: Phone, placeholder: "e.g. +1 555 123 4567 (include country code)" },
];

function searchLink(platform: string, url: string): PlatformResult {
  return { platform, url, status: "unknown", confidence: "heuristic" };
}

// Phone mode needs no server round-trip — libphonenumber-js parses/
// validates fully client-side (same "real check, no fabrication"
// standard as everything else: country/validity/line-type are genuine
// parsed facts, not guesses). The rest are correctly-built search/deep
// links, same honest "heuristic" meaning as name-mode's social links.
function buildPhoneResults(raw: string): PlatformResult[] {
  const parsed = parsePhoneNumberFromString(raw);
  if (!parsed) {
    return [
      {
        platform: "Number Format",
        url: "",
        status: "not_found",
        confidence: "reliable",
        note: "Couldn't parse this as a phone number. Include the country code, e.g. +1 555 123 4567 or +962 7 9012 3456.",
      },
    ];
  }

  const e164 = parsed.number; // "+15551234567"
  const infoParts = [
    parsed.country ? `Region: ${parsed.country}` : "Region: unknown",
    parsed.isValid() ? "Valid number format" : "Format doesn't match a real number for this region",
  ];
  const type = parsed.getType();
  if (type) infoParts.push(`Likely line type: ${type.replace(/_/g, " ")}`);
  infoParts.push(`International: ${parsed.formatInternational()}`);
  infoParts.push(
    "No free source can tell you WHO owns a number (that's exactly what Truecaller/paid data brokers sell access to) — this is only ever the number's own technical facts."
  );

  const q = encodeURIComponent(`"${e164}"`);
  const results: PlatformResult[] = [
    {
      platform: "Number Info",
      url: "",
      status: parsed.isValid() ? "found" : "not_found",
      confidence: "reliable",
      note: infoParts.join(" · "),
    },
    searchLink("WhatsApp", `https://wa.me/${e164.replace("+", "")}`),
    searchLink("Telegram", `https://t.me/${e164}`),
    searchLink("Google Search", `https://www.google.com/search?q=${q}`),
    searchLink("Bing Search", `https://www.bing.com/search?q=${q}`),
  ];

  // Truecaller's public web search page — included on explicit request.
  // Unlike WhatsApp's officially-documented wa.me scheme, this URL
  // pattern isn't something Truecaller formally publishes, so it carries
  // more uncertainty than the other links here; still worth offering
  // since it's the one place that sometimes actually has a caller-ID
  // name for a number, which nothing free/keyless can otherwise provide.
  if (parsed.country) {
    results.push(
      searchLink("Truecaller", `https://www.truecaller.com/search/${parsed.country.toLowerCase()}/${parsed.nationalNumber}`)
    );
  }

  return results;
}

const STATUS_COLOR: Record<CheckStatus, string> = {
  found: "#34d399",
  not_found: "#475569",
  unknown: "#f59e0b",
};
const STATUS_LABEL: Record<CheckStatus, string> = {
  found: "Profile exists",
  not_found: "Not found",
  unknown: "Couldn't verify",
};

// A confirmed hit always links out; an unverified heuristic result still
// gets a link (a human clicking through is the actual OSINT workflow for
// bot-walled platforms) — the only case with no useful link is a
// confidently-negative "reliable" result, since there's nothing to check.
// Info-only nodes (phone mode's parsed-number summary) never have a URL
// at all — they're a fact, not a place to click through to.
function isClickable(r: PlatformResult) {
  if (!r.url) return false;
  return r.status === "found" || r.confidence === "heuristic";
}

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

function CenterNode({ data }: { data: { label: string } }) {
  return (
    <div
      className="rounded-full flex items-center justify-center text-center px-2 neural-pulse"
      style={{
        width: 116,
        height: 116,
        background: "radial-gradient(circle, rgba(245,158,11,0.28), rgba(13,10,24,0.95))",
        border: "2px solid #f59e0b",
        boxShadow: "0 0 34px rgba(245,158,11,0.45)",
      }}
    >
      {HANDLES}
      <span className="text-xs font-mono text-accent-glow break-all leading-tight">{data.label}</span>
    </div>
  );
}

function PlatformNode({ data }: { data: { platform: string; status: CheckStatus; delay: number } }) {
  const color = STATUS_COLOR[data.status];
  return (
    <div className="neural-float" style={{ animationDelay: `${data.delay}s` }}>
      {HANDLES}
      <div
        className="rounded-full flex flex-col items-center justify-center text-center cursor-pointer transition-transform hover:scale-110"
        style={{ width: 76, height: 76, background: "#0d0a18", border: `2px solid ${color}`, boxShadow: `0 0 12px ${color}55` }}
      >
        <span className="text-[10px] font-semibold px-1 leading-tight" style={{ color }}>{data.platform}</span>
      </div>
    </div>
  );
}

const nodeTypes = { center: CenterNode, platform: PlatformNode };

function buildGraph(username: string, results: PlatformResult[]): { nodes: Node[]; edges: Edge[] } {
  const RADIUS = 260;
  const nodes: Node[] = [
    { id: "__center", type: "center", position: { x: -58, y: -58 }, data: { label: username }, draggable: true },
  ];
  const edges: Edge[] = [];

  results.forEach((r, i) => {
    const angle = (i / results.length) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * RADIUS - 38;
    const y = Math.sin(angle) * RADIUS - 38;
    const color = STATUS_COLOR[r.status];
    nodes.push({
      id: r.platform,
      type: "platform",
      position: { x, y },
      data: { platform: r.platform, status: r.status, delay: (i % 6) * 0.4 },
      draggable: true,
    });
    edges.push({
      id: `e-${r.platform}`,
      source: "__center",
      target: r.platform,
      type: "straight",
      animated: r.status !== "not_found",
      style: { stroke: color, strokeWidth: 1.4, opacity: r.status === "not_found" ? 0.25 : 0.7 },
    });
  });

  return { nodes, edges };
}

export default function UsernameOsint() {
  const [mode, setMode] = useState<Mode>("username");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PlatformResult[] | null>(null);
  const [selected, setSelected] = useState<PlatformResult | null>(null);
  const { mergeGraph, addTimelineEvent } = useInvestigation();

  function pinToGraph() {
    if (!results || mode !== "username" || !username.trim()) return;
    const found = results.filter((r) => r.status === "found");
    const id = `username:${username.trim().toLowerCase()}`;
    mergeGraph(
      [
        {
          id,
          type: "username",
          label: username.trim(),
          detail: found.length > 0 ? `Confirmed on ${found.map((f) => f.platform).join(", ")}` : "No confirmed platform matches",
        },
      ],
      []
    );
    addTimelineEvent({ tool: "username", label: "Username pinned", detail: username.trim() });
  }

  function exportReport() {
    if (!results || !username.trim()) return;
    openReport(buildUsernameReport(username.trim(), mode, results));
  }

  function switchMode(next: Mode) {
    setMode(next);
    setUsername("");
    setResults(null);
    setSelected(null);
    setError(null);
  }

  async function run() {
    const target = username.trim();
    if (!target) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setSelected(null);

    if (mode === "phone") {
      // Fully client-side — no network round-trip needed.
      setResults(buildPhoneResults(target));
      setLoading(false);
      return;
    }

    try {
      const endpoint = mode === "name" ? "/api/osint/name" : "/api/osint/username";
      const res = await fetch(`${endpoint}?target=${encodeURIComponent(target)}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Lookup failed.");
        return;
      }
      setResults(json.results);
    } catch {
      setError("Network error reaching the lookup API.");
    } finally {
      setLoading(false);
    }
  }

  const graph = useMemo(() => (results ? buildGraph(username.trim(), results) : null), [results, username]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // useNodesState/useEdgesState only seed their initial value once at
  // mount — this component is already mounted (and its graph starts
  // empty) when a search runs, so results arriving later never reached
  // the graph without explicitly pushing them in here.
  useEffect(() => {
    setNodes(graph?.nodes ?? []);
    setEdges(graph?.edges ?? []);
  }, [graph, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: any, node: Node) => {
      if (node.id === "__center" || !results) return;
      const r = results.find((x) => x.platform === node.id) ?? null;
      setSelected(r);
    },
    [results]
  );

  const foundCount = results?.filter((r) => r.status === "found").length ?? 0;
  const activeMode = MODES.find((m) => m.id === mode)!;

  const DESCRIPTIONS: Record<Mode, ReactNode> = {
    username: (
      <>
        For legitimate investigative use — tracing a suspected threat actor's alias, or confirming
        who actually controls a piece of phishing/malware infrastructure. Checks whether a{" "}
        <em>public, unauthenticated</em> profile page exists for a handle across platforms — it does{" "}
        <strong>not</strong> confirm the accounts belong to the same person, only that the handle is
        taken there. Don't use this to target a private individual without a legitimate reason.
      </>
    ),
    name: (
      <>
        Search a real full name or company name. Three sources are genuinely checked, not just
        links — the public company registry (OpenCorporates), Wikipedia (real summary text when a
        matching article exists), and GitHub's search API. There is{" "}
        <strong>no free keyless API for general people-search</strong> across social platforms, so
        those nodes are correctly-built search links for you to open and verify by eye, not
        confirmed matches — the graph is honest about which is which.
      </>
    ),
    phone: (
      <>
        Parses the number itself locally in your browser (region, validity, likely line type — real
        data, via <code className="font-mono">libphonenumber-js</code>) and builds WhatsApp/Telegram
        deep links plus search links. There is no free keyless reverse-phone-lookup API — this
        surfaces the right places to check, it doesn't claim to identify the owner.
      </>
    ),
  };

  return (
    <div className="glass-panel p-4 space-y-4">
      <div>
        <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
          <UserSearch className="h-4 w-4 text-accent" /> Username / Name / Phone OSINT
        </h2>
        <p className="text-xs text-slate-500">{DESCRIPTIONS[mode]}</p>
      </div>

      <div className="flex gap-1.5 border-b border-border pb-2.5">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => switchMode(m.id)}
            className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${
              mode === m.id
                ? "border-accent/60 bg-accent/15 text-accent-glow"
                : "border-border text-slate-500 hover:text-slate-300 hover:border-border/80"
            }`}
          >
            <m.icon className="h-3 w-3" /> {m.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder={activeMode.placeholder}
          dir="ltr"
          className="flex-1 bg-panel/60 border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
        />
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={run}
          disabled={loading || !username.trim()}
          className="px-4 py-2 rounded-lg bg-accent/80 hover:bg-accent text-white text-sm disabled:opacity-40 transition-colors flex items-center gap-1.5"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? "Checking…" : "Check"}
        </motion.button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {results && (
        <>
          <div className="flex justify-end gap-2">
            {mode === "username" && (
              <button
                onClick={pinToGraph}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
              >
                <Pin className="h-3 w-3" /> Pin to Intelligence Graph
              </button>
            )}
            <button
              onClick={exportReport}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-slate-300 hover:border-accent/50 hover:text-slate-100 transition-colors"
            >
              <FileDown className="h-3 w-3" /> Export Report
            </button>
          </div>
          <div className="flex items-center gap-4 text-[10px] hud-text text-slate-500">
            <span><span className="text-emerald-400 font-bold">{foundCount}</span> confirmed</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_COLOR.found }} />found</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_COLOR.unknown }} />unverified</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_COLOR.not_found }} />not found</span>
            <span className="ml-auto">click a node for detail · drag to rearrange</span>
          </div>

          <div className="relative rounded-lg border border-border/60 overflow-hidden h-[520px] bg-[#05040a]">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              fitView
              fitViewOptions={{ padding: 0.3 }}
              proOptions={{ hideAttribution: true }}
              nodesConnectable={false}
            >
              <Background color="#2e234e" gap={24} />
            </ReactFlow>

            {selected && (
              <div className="absolute top-3 right-3 w-72 rounded-lg border border-border bg-[#0d0a18]/95 backdrop-blur-sm p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-semibold" style={{ color: STATUS_COLOR[selected.status] }}>{selected.platform}</p>
                  <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-slate-300">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">
                  {STATUS_LABEL[selected.status]} · {selected.confidence}
                </p>
                {selected.note && (
                  <p className="text-[11px] text-slate-300 mb-2 leading-relaxed">{selected.note}</p>
                )}
                {isClickable(selected) ? (
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-accent-glow hover:underline flex items-center gap-1"
                  >
                    {selected.status === "found" ? "Open confirmed profile" : "Check manually"} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  !selected.note && (
                    <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
                      <Info className="h-3 w-3 shrink-0 mt-0.5" />
                      {selected.status === "not_found" ? "Confidently not registered on this platform." : "No usable signal — nothing to open."}
                    </p>
                  )
                )}
              </div>
            )}
          </div>

          <p className="text-[10px] text-slate-600">
            {mode === "username" &&
              "Amber \"unverified\" nodes come from platforms (Instagram, Facebook, X, LinkedIn) that block most automated checks — the link still opens the real profile URL so you can verify by eye, it just isn't a confirmed match the way the green nodes are."}
            {mode === "name" &&
              "Green = a real match (OpenCorporates registry, Wikipedia article, or GitHub search). Amber nodes are correctly-built search links, not confirmed matches — there's no free API that can verify a person/company match across social platforms."}
            {mode === "phone" &&
              "The center-adjacent \"Number Info\" node is a real parsed result (region/validity/line type). WhatsApp/Telegram/search nodes are links to check manually — none of them confirm who owns the number."}
          </p>
        </>
      )}
    </div>
  );
}
