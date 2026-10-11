"use client";

import { useEffect, useState } from "react";
import { Newspaper, ShieldAlert, AlertTriangle, Activity } from "lucide-react";
import { useInvestigation } from "@/contexts/InvestigationContext";

type FeedItem = {
  timestamp: string;
  kind: "news" | "kev" | "cve";
  title: string;
  href?: string;
  cveId?: string;
};

const ICONS = { news: Newspaper, kev: ShieldAlert, cve: AlertTriangle };
const ICON_COLOR = { news: "text-slate-400", kev: "text-red-400", cve: "text-amber-400" };

export default function GlobalActivityFeed() {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const { runLookup, setActiveTool } = useInvestigation();

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/api/news").then((r) => r.json()).catch(() => ({ items: [] })),
      fetch("/api/kev").then((r) => r.json()).catch(() => ({ items: [] })),
      fetch("/api/cve").then((r) => r.json()).catch(() => ({ items: [] })),
    ]).then(([news, kev, cve]) => {
      if (cancelled) return;

      const merged: FeedItem[] = [
        ...(news.items ?? []).map((n: any) => ({
          timestamp: n.pubDate,
          kind: "news" as const,
          title: n.title,
          href: n.link,
        })),
        ...(kev.items ?? []).map((k: any) => ({
          timestamp: k.dateAdded,
          kind: "kev" as const,
          title: `${k.cveID} added to CISA KEV — ${k.vendorProject} ${k.product}`,
          cveId: k.cveID,
        })),
        ...(cve.items ?? []).map((c: any) => ({
          timestamp: c.published,
          kind: "cve" as const,
          title: `${c.id} published (CVSS ${c.score ?? "?"})`,
          cveId: c.id,
        })),
      ]
        .filter((i) => i.timestamp)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 30);

      setItems(merged);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleClick(item: FeedItem) {
    if (item.href) {
      window.open(item.href, "_blank", "noopener,noreferrer");
    } else if (item.cveId) {
      setActiveTool("overview");
      runLookup(item.cveId);
    }
  }

  return (
    <div className="glass-panel p-4 flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4 text-accent" />
        <h2 className="font-display font-semibold text-sm text-slate-100">Global Activity</h2>
      </div>

      {!items && (
        <div className="space-y-2 animate-pulse">
          {[...Array(6)].map((_, i) => <div key={i} className="h-4 bg-border/60 rounded w-full" />)}
        </div>
      )}

      {items && items.length === 0 && <p className="text-xs text-slate-500">No recent activity available right now.</p>}

      <ul className="space-y-2 overflow-y-auto pr-1 flex-1">
        {items?.map((item, i) => {
          const Icon = ICONS[item.kind];
          return (
            <li key={i}>
              <button
                onClick={() => handleClick(item)}
                className="flex items-start gap-2 text-left w-full hover:bg-panel/40 rounded-lg p-1.5 -m-1.5 transition-colors"
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${ICON_COLOR[item.kind]}`} />
                <div className="min-w-0">
                  <p className="text-xs text-slate-300 leading-snug">{item.title}</p>
                  <p className="text-[10px] text-slate-500 font-mono">
                    {new Date(item.timestamp).toLocaleString()}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
