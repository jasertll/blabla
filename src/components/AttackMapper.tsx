"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Crosshair, Search, Tag, X, Grid3x3, List } from "lucide-react";
import { ATTACK_TACTICS, ATTACK_TECHNIQUES, type AttackTactic } from "@/lib/attackData";
import { loadTaggedTechniques, setTechniqueTagged, type TaggedTechniques } from "@/lib/attackTagging";
import { useInvestigation } from "@/contexts/InvestigationContext";

type Tagged = TaggedTechniques;
const loadTagged = loadTaggedTechniques;

// Deliberately not severity-coded (red/amber/etc.) — a tagged technique
// isn't "bad", it's "this is one you've actually seen", so the heatmap
// uses the neutral accent color at increasing opacity instead of
// borrowing colors that mean something else everywhere else in this app.
function heatColor(count: number): string {
  if (count === 0) return "bg-surface-elevated border-border";
  if (count === 1) return "bg-accent/15 border-accent/30";
  if (count <= 3) return "bg-accent/30 border-accent/50";
  return "bg-accent/50 border-accent/70";
}

export default function AttackMapper() {
  const [tagged, setTagged] = useState<Tagged>({});
  const [query, setQuery] = useState("");
  const [tacticFilter, setTacticFilter] = useState<AttackTactic | "all">("all");
  const [view, setView] = useState<"browse" | "heatmap">("browse");
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const { addTimelineEvent } = useInvestigation();

  useEffect(() => {
    setTagged(loadTagged());
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ATTACK_TECHNIQUES.filter((t) => {
      if (tacticFilter !== "all" && t.tactic !== tacticFilter) return false;
      if (!q) return true;
      return t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
    });
  }, [query, tacticFilter]);

  const grouped = useMemo(() => {
    const map = new Map<AttackTactic, typeof ATTACK_TECHNIQUES>();
    for (const tactic of ATTACK_TACTICS) map.set(tactic, []);
    for (const t of filtered) map.get(t.tactic)!.push(t);
    return map;
  }, [filtered]);

  const countByTactic = useMemo(() => {
    const map = new Map<AttackTactic, number>();
    for (const tactic of ATTACK_TACTICS) map.set(tactic, 0);
    for (const id of Object.keys(tagged)) {
      const t = ATTACK_TECHNIQUES.find((x) => x.id === id);
      if (t) map.set(t.tactic, (map.get(t.tactic) ?? 0) + 1);
    }
    return map;
  }, [tagged]);

  function toggleTag(id: string) {
    const willTag = !tagged[id];
    if (willTag) {
      const t = ATTACK_TECHNIQUES.find((x) => x.id === id);
      if (t) addTimelineEvent({ tool: "attack", label: "ATT&CK technique tagged", detail: `${t.id} — ${t.name}` });
    }
    setTagged(setTechniqueTagged(id, willTag, noteDraft[id]?.trim() ?? ""));
  }

  function saveNote(id: string) {
    if (!tagged[id]) return;
    setTagged(setTechniqueTagged(id, true, noteDraft[id]?.trim() ?? ""));
  }

  const taggedCount = Object.keys(tagged).length;

  return (
    <div className="glass-panel p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display font-semibold text-sm text-slate-100 mb-1 flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-accent" /> ATT&CK Technique Matrix
          </h2>
          <p className="text-xs text-slate-500 max-w-xl">
            {ATTACK_TECHNIQUES.length} curated top-level techniques across all 14 Enterprise tactics. Tag
            ones you've actually encountered — saved locally in your browser, builds into the coverage
            heatmap below over time.
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-border p-0.5">
          <button
            onClick={() => setView("browse")}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-colors ${view === "browse" ? "bg-surface-high text-slate-100" : "text-slate-500 hover:text-slate-300"}`}
          >
            <List className="h-3.5 w-3.5" /> Browse
          </button>
          <button
            onClick={() => setView("heatmap")}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-colors ${view === "heatmap" ? "bg-surface-high text-slate-100" : "text-slate-500 hover:text-slate-300"}`}
          >
            <Grid3x3 className="h-3.5 w-3.5" /> Heatmap ({taggedCount})
          </button>
        </div>
      </div>

      {view === "browse" ? (
        <>
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-600" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by ID, name, or description…"
                className="w-full bg-panel/60 border border-border rounded-lg pr-8 pl-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
              />
            </div>
            <select
              value={tacticFilter}
              onChange={(e) => setTacticFilter(e.target.value as AttackTactic | "all")}
              className="bg-panel/60 border border-border rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-accent"
            >
              <option value="all">All tactics</option>
              {ATTACK_TACTICS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1">
            {ATTACK_TACTICS.filter((tactic) => (grouped.get(tactic)?.length ?? 0) > 0).map((tactic) => (
              <div key={tactic}>
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
                  {tactic} <span className="text-slate-700">({grouped.get(tactic)!.length})</span>
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {grouped.get(tactic)!.map((t) => {
                    const isTagged = !!tagged[t.id];
                    return (
                      <motion.div
                        key={t.id}
                        layout
                        className={`rounded-lg border p-3 text-xs transition-colors ${isTagged ? "border-accent/40 bg-accent/5" : "border-border"}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-mono text-slate-300">
                              {t.id} <span className="font-sans text-slate-100 font-semibold">{t.name}</span>
                            </p>
                            <p className="text-slate-500 mt-1 leading-relaxed">{t.description}</p>
                          </div>
                          <button
                            onClick={() => toggleTag(t.id)}
                            title={isTagged ? "Untag" : "Tag as observed"}
                            className={`shrink-0 flex items-center justify-center h-7 w-7 rounded-full border transition-colors ${
                              isTagged ? "border-accent bg-accent/20 text-accent-glow" : "border-border text-slate-500 hover:border-accent/50 hover:text-accent-glow"
                            }`}
                          >
                            {isTagged ? <X className="h-3.5 w-3.5" /> : <Tag className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                        {isTagged && (
                          <div className="mt-2 flex gap-1.5">
                            <input
                              value={noteDraft[t.id] ?? tagged[t.id]?.note ?? ""}
                              onChange={(e) => setNoteDraft((d) => ({ ...d, [t.id]: e.target.value }))}
                              onBlur={() => saveNote(t.id)}
                              onKeyDown={(e) => e.key === "Enter" && saveNote(t.id)}
                              placeholder="Note (which investigation, evidence…)"
                              className="flex-1 bg-surface border border-border rounded px-2 py-1 text-[11px] text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-accent"
                            />
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            ))}
            {filtered.length === 0 && <p className="text-xs text-slate-600 text-center py-8">No techniques match that search.</p>}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          {taggedCount === 0 ? (
            <p className="text-xs text-slate-600 text-center py-8">
              Nothing tagged yet — switch to Browse and tag techniques as you actually encounter them in investigations.
            </p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {ATTACK_TACTICS.map((tactic) => {
                  const count = countByTactic.get(tactic) ?? 0;
                  return (
                    <div key={tactic} className={`rounded-lg border p-3 ${heatColor(count)}`}>
                      <p className="text-xs font-semibold text-slate-200">{tactic}</p>
                      <p className="text-2xl font-display font-bold text-slate-100 mt-1">{count}</p>
                      <p className="text-[10px] text-slate-500">technique{count === 1 ? "" : "s"} seen</p>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                {Object.entries(tagged)
                  .sort((a, b) => b[1].taggedAt - a[1].taggedAt)
                  .map(([id, info]) => {
                    const t = ATTACK_TECHNIQUES.find((x) => x.id === id);
                    if (!t) return null;
                    return (
                      <div key={id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs">
                        <div className="min-w-0">
                          <p className="font-mono text-slate-300">{t.id} <span className="font-sans text-slate-200">{t.name}</span></p>
                          {info.note && <p className="text-slate-500 text-[11px] mt-0.5 truncate">{info.note}</p>}
                        </div>
                        <span className="shrink-0 text-[10px] text-slate-600">{new Date(info.taggedAt).toISOString().slice(0, 10)}</span>
                      </div>
                    );
                  })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
