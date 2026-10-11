"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { detectIndicator, IndicatorType } from "@/lib/detectIndicator";
import type { GraphNodeData, GraphEdgeData } from "@/lib/intelligenceGraph";
import { inferEdges } from "@/lib/graphLinking";

export type ToolId = "overview" | "ip" | "domain" | "email" | "file" | "stego" | "utilities" | "camera" | "webapp" | "forensics" | "library" | "graph" | "space" | "username" | "recon" | "gold" | "canary" | "pdf" | "certwatch" | "attack" | "pcap" | "c2pa" | "surface" | "exposure" | "yara" | "imageintel" | "world";

export type Handoff = { tool: "ip" | "domain"; value: string; nonce: number } | null;

export type InvestigationLocation = { label: string; lat: number; lon: number; country: string | null };

export type TimelineEvent = { id: string; tool: ToolId; label: string; detail?: string; at: number };

export type InvestigationState = {
  // Retained for hash quick-lookups only — IP/domain now live in their
  // own dedicated tools (IpAnalyzer / DomainScan) with their own inputs.
  query: string;
  type: IndicatorType;
  loading: boolean;
  error: string | null;
  data: any | null;
  activeTool: ToolId;
  handoff: Handoff;
  recentLocations: InvestigationLocation[];
  sessionLookupCount: number;
  graphNodes: GraphNodeData[];
  graphEdges: GraphEdgeData[];
  timeline: TimelineEvent[];
  toolAlerts: Partial<Record<ToolId, boolean>>;
};

type Ctx = InvestigationState & {
  runLookup: (raw: string) => Promise<void>;
  setActiveTool: (tool: ToolId) => void;
  clearHandoff: () => void;
  addLocation: (loc: InvestigationLocation) => void;
  incrementSessionCount: () => void;
  mergeGraph: (nodes: GraphNodeData[], edges: GraphEdgeData[]) => void;
  addTimelineEvent: (event: { tool: ToolId; label: string; detail?: string }) => void;
  setToolAlert: (tool: ToolId, active: boolean) => void;
};

const InvestigationContext = createContext<Ctx | null>(null);

export function InvestigationProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<InvestigationState>({
    query: "",
    type: "unknown",
    loading: false,
    error: null,
    data: null,
    activeTool: "overview",
    handoff: null,
    recentLocations: [],
    sessionLookupCount: 0,
    graphNodes: [],
    graphEdges: [],
    timeline: [],
    toolAlerts: {},
  });

  const setActiveTool = useCallback((tool: ToolId) => {
    setState((s) => ({ ...s, activeTool: tool }));
  }, []);

  const clearHandoff = useCallback(() => {
    setState((s) => ({ ...s, handoff: null }));
  }, []);

  const addLocation = useCallback((loc: InvestigationLocation) => {
    setState((s) => {
      const withoutDupe = s.recentLocations.filter((l) => l.label !== loc.label);
      return { ...s, recentLocations: [loc, ...withoutDupe].slice(0, 25) };
    });
  }, []);

  const incrementSessionCount = useCallback(() => {
    setState((s) => ({ ...s, sessionLookupCount: s.sessionLookupCount + 1 }));
  }, []);

  const mergeGraph = useCallback((newNodes: GraphNodeData[], newEdges: GraphEdgeData[]) => {
    setState((s) => {
      const nodeMap = new Map(s.graphNodes.map((n) => [n.id, n]));
      for (const n of newNodes) nodeMap.set(n.id, n); // last scan wins for that node's data
      const edgeMap = new Map(s.graphEdges.map((e) => [e.id, e]));
      for (const e of newEdges) edgeMap.set(e.id, e);

      const allNodes = Array.from(nodeMap.values());
      // Auto-relationship inference: whatever this pin explicitly connected
      // is already in edgeMap above — this additionally links the new
      // node(s) to anything already on the graph (or to each other) that
      // shares a real signal (same IP, domain, org/ASN, cert issuer, or
      // WiFi SSID), so two unrelated-looking scans that turn out to
      // overlap get connected automatically instead of staying as
      // disconnected dots the user has to notice and link by hand.
      const autoEdges = inferEdges(newNodes, allNodes, Array.from(edgeMap.values()));
      for (const e of autoEdges) edgeMap.set(e.id, e);

      return { ...s, graphNodes: allNodes, graphEdges: Array.from(edgeMap.values()) };
    });
  }, []);

  const addTimelineEvent = useCallback((event: { tool: ToolId; label: string; detail?: string }) => {
    setState((s) => {
      const entry: TimelineEvent = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now(), ...event };
      return { ...s, timeline: [entry, ...s.timeline].slice(0, 200) };
    });
  }, []);

  const setToolAlert = useCallback((tool: ToolId, active: boolean) => {
    setState((s) => ({ ...s, toolAlerts: { ...s.toolAlerts, [tool]: active } }));
  }, []);

  const runLookup = useCallback(async (raw: string) => {
    const type = detectIndicator(raw);

    // IP and domain/URL targets hand off to their own dedicated tool
    // (separate input, separate scan) instead of being fetched here.
    if (type === "ipv4" || type === "ipv6") {
      setState((s) => ({ ...s, activeTool: "ip", handoff: { tool: "ip", value: raw.trim(), nonce: Date.now() } }));
      return;
    }
    if (type === "domain" || type === "url") {
      let value = raw.trim();
      if (type === "url") {
        try { value = new URL(value).hostname; } catch { /* keep raw */ }
      }
      setState((s) => ({ ...s, activeTool: "domain", handoff: { tool: "domain", value, nonce: Date.now() } }));
      return;
    }

    if (type === "md5" || type === "sha1" || type === "sha256" || type === "cve") {
      setState((s) => ({ ...s, query: raw, type, loading: true, error: null, data: null, activeTool: "overview" }));
      const endpoint = type === "cve"
        ? `/api/cve/lookup?id=${encodeURIComponent(raw.trim())}`
        : `/api/osint/hash?target=${encodeURIComponent(raw.trim())}`;
      try {
        const res = await fetch(endpoint);
        const json = await res.json();
        if (!res.ok && res.status !== 429) {
          setState((s) => ({ ...s, loading: false, error: json.error ?? `HTTP ${res.status}` }));
          return;
        }
        setState((s) => ({ ...s, loading: false, data: json, sessionLookupCount: s.sessionLookupCount + 1 }));
      } catch {
        setState((s) => ({ ...s, loading: false, error: "Network error reaching the lookup API." }));
      }
      return;
    }

    setState((s) => ({
      ...s,
      query: raw,
      type,
      loading: false,
      error: "This input type isn't supported by quick search. Use the Email Header tool for headers, or the File Inspector for documents.",
      data: null,
      activeTool: "overview",
    }));
  }, []);

  return (
    <InvestigationContext.Provider value={{ ...state, runLookup, setActiveTool, clearHandoff, addLocation, incrementSessionCount, mergeGraph, addTimelineEvent, setToolAlert }}>
      {children}
    </InvestigationContext.Provider>
  );
}

export function useInvestigation() {
  const ctx = useContext(InvestigationContext);
  if (!ctx) {
    throw new Error("useInvestigation must be used within InvestigationProvider");
  }
  return ctx;
}
