"use client";

import ExploitRadar from "@/components/ExploitRadar";
import GlobalActivityFeed from "@/components/GlobalActivityFeed";
import LiveStats from "@/components/LiveStats";
import ResultsPanel from "@/components/ResultsPanel";
import ThreatGlobe from "@/components/ThreatGlobe";

/** The Overview dashboard, composed from the original pieces. */
export default function OverviewTool() {
  return (
    <div className="space-y-4">
      <LiveStats />
      <ThreatGlobe />
      <div className="grid gap-4 lg:grid-cols-2">
        <ExploitRadar />
        <GlobalActivityFeed />
      </div>
      <ResultsPanel />
    </div>
  );
}
