"use client";

import { Component, lazy, Suspense, useMemo, type ComponentType, type ReactNode } from "react";
import type { ToolId } from "@/contexts/InvestigationContext";

// Every tool is code-split: its engine (TensorFlow, OpenCV, YARA-X, pdf.js…)
// downloads only when someone walks into its room.

type Loader = () => Promise<{ default: ComponentType }>;

const LOADERS: Record<ToolId, Loader> = {
  overview: () => import("./OverviewTool"),
  ip: () => import("@/components/IpAnalyzer"),
  domain: () => import("@/components/DomainScan"),
  webapp: () => import("@/components/WebAppScan"),
  camera: () => import("@/components/CameraCheck"),
  certwatch: () => import("@/components/CertWatch"),
  surface: () => import("@/components/AttackSurfaceReport"),
  username: () => import("@/components/UsernameOsint"),
  recon: () => import("@/components/ReconToolkit"),
  exposure: () => import("@/components/ExposureDashboard"),
  email: () => import("@/components/EmailHeaderTool"),
  file: () => import("@/components/FileInspector"),
  stego: () => import("@/components/Steganography"),
  forensics: () => import("@/components/Forensics"),
  library: () => import("@/components/ForensicsLibrary"),
  canary: () => import("@/components/CanaryToken"),
  pdf: () => import("@/components/pdf-toolkit/PdfToolkit"),
  pcap: () => import("@/components/PcapAnalyzer"),
  c2pa: () => import("@/components/C2paChecker"),
  yara: () => import("@/components/YaraTester"),
  imageintel: () => import("@/components/imageIntel/ImageIntelWorkspace"),
  graph: () => import("@/components/IntelligenceGraph"),
  space: () => import("@/components/SatelliteTracker"),
  gold: () => import("@/components/GoldEngine"),
  attack: () => import("@/components/AttackMapper"),
  utilities: () => import("@/components/Utilities"),
  world: () => import("@/components/world/WorldScene"),
};

const lazyCache = new Map<ToolId, ComponentType>();
function lazyTool(id: ToolId) {
  let c = lazyCache.get(id);
  if (!c) {
    c = lazy(LOADERS[id]);
    lazyCache.set(id, c);
  }
  return c;
}

class ToolBoundary extends Component<{ children: ReactNode; name: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-xl border border-severity-critical/50 bg-severity-critical/10 p-6">
        <p className="hud-text text-xs text-severity-critical">The instrument failed to start</p>
        <p className="mt-2 text-sm text-slate-300">
          {this.props.name}: {this.state.error.message}
        </p>
      </div>
    );
  }
}

export function ToolView({ refId, name }: { refId: ToolId; name: string }) {
  const Tool = useMemo(() => lazyTool(refId), [refId]);
  return (
    <ToolBoundary name={name} key={refId}>
      <Suspense
        fallback={
          <div className="space-y-3">
            <div className="skeleton-block h-20" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="skeleton-block h-28" />
              ))}
            </div>
          </div>
        }
      >
        <Tool />
      </Suspense>
    </ToolBoundary>
  );
}

/** Warm a tool's chunk before the camera finishes its push-in. */
export function preloadTool(refId: ToolId) {
  void LOADERS[refId]().catch(() => {});
}
