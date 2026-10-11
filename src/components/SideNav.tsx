"use client";

import { useState } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { useInvestigation } from "@/contexts/InvestigationContext";
import { NAV_GROUPS as GROUPS } from "@/lib/navItems";

// Grouped by real function, not aspirational categories — every group
// here maps to tools that actually exist and actually work. A SOC-style
// rail with empty "Threat Actors" / "Cases" / "Reports" stubs would look
// the part but lie about what's actually built; better to group honestly
// and grow the groups as real features land. Shared with CommandPalette
// via lib/navItems.ts so the two never drift out of sync.

export default function SideNav() {
  const { activeTool, setActiveTool, toolAlerts } = useInvestigation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`hidden md:flex shrink-0 flex-col border-r border-border bg-surface/70 backdrop-blur-sm transition-[width] duration-200 ${
        collapsed ? "w-14" : "w-60"
      }`}
    >
      <nav className="flex-1 overflow-y-auto py-5 px-3 space-y-6">
        {GROUPS.map((group) => (
          <div key={group.id}>
            {!collapsed && (
              <p className="px-2.5 mb-2 text-[9px] font-semibold tracking-widest text-slate-600 uppercase hud-text">
                {group.label}
              </p>
            )}
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = activeTool === item.id;
                const alert = !!toolAlerts[item.id];
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTool(item.id)}
                    title={collapsed ? (alert ? `${item.label} — notable findings` : item.label) : undefined}
                    className={`w-full flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-xs font-medium transition-colors relative ${
                      active
                        ? "bg-surface-high text-slate-100"
                        : "text-slate-500 hover:text-slate-200 hover:bg-surface-elevated"
                    }`}
                  >
                    {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent" aria-hidden="true" />}
                    <span className="relative shrink-0">
                      <item.icon className={`h-3.5 w-3.5 ${active ? "text-accent-glow" : ""}`} />
                      {alert && (
                        <span
                          className="absolute -top-1 -right-1 h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse"
                          aria-hidden="true"
                          title="Notable findings from your last scan"
                        />
                      )}
                    </span>
                    {!collapsed && <span className="truncate text-left">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-2 px-3.5 py-2.5 text-[10px] text-slate-600 hover:text-slate-300 border-t border-border/60 transition-colors"
      >
        {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
        {!collapsed && "COLLAPSE"}
      </button>
    </aside>
  );
}
