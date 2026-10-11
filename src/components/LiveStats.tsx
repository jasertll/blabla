"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, AlertTriangle, Newspaper, Radar } from "lucide-react";
import { useInvestigation } from "@/contexts/InvestigationContext";
import Tilt3D from "@/components/Tilt3D";

export default function LiveStats() {
  const [kevCount, setKevCount] = useState<number | null>(null);
  const [cveCount, setCveCount] = useState<number | null>(null);
  const [newsCount, setNewsCount] = useState<number | null>(null);
  const { sessionLookupCount } = useInvestigation();

  useEffect(() => {
    fetch("/api/kev").then((r) => r.json()).then((d) => setKevCount(d.items?.length ?? 0)).catch(() => setKevCount(0));
    fetch("/api/cve").then((r) => r.json()).then((d) => setCveCount(d.items?.length ?? 0)).catch(() => setCveCount(0));
    fetch("/api/news").then((r) => r.json()).then((d) => setNewsCount(d.items?.length ?? 0)).catch(() => setNewsCount(0));
  }, []);

  const stats = [
    { label: "Recent KEV Additions", value: kevCount, icon: ShieldAlert, tone: "text-red-300" },
    { label: "Critical CVEs (sample)", value: cveCount, icon: AlertTriangle, tone: "text-amber-300" },
    { label: "News Items", value: newsCount, icon: Newspaper, tone: "text-slate-300" },
    { label: "Your Investigations", value: sessionLookupCount, icon: Radar, tone: "text-accent-glow" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map((s) => (
        <Tilt3D key={s.label} maxDeg={5}>
          <div className="glass-panel p-3 flex items-center gap-2.5 h-full">
            <s.icon className={`h-4 w-4 shrink-0 ${s.tone}`} />
            <div>
              <p className={`text-lg font-display font-bold ${s.tone}`}>{s.value ?? "—"}</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide leading-tight">{s.label}</p>
            </div>
          </div>
        </Tilt3D>
      ))}
    </div>
  );
}
