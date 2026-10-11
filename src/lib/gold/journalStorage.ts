// Client-only, localStorage-backed trade journal. There's no database in
// this app, so "real personal track record" has to live somewhere — the
// browser's own storage is the honest, zero-infrastructure option, which
// is why every function here is a no-op on the server (typeof window
// guard) and why the UI that uses this discloses plainly that the journal
// doesn't sync across devices/browsers. This is deliberately NOT the same
// thing as the backtest engine's historical simulation: this only ever
// records decisions the user actually saw and outcomes they report
// themselves, so its win rate reflects real usage, not a simulation.

export type JournalOutcome = "open" | "tp1" | "tp2" | "tp3" | "sl" | "breakeven" | "manual";

export type JournalEntry = {
  id: string;
  loggedAt: number;
  direction: "buy" | "sell";
  primaryTimeframe: string;
  entryPrice: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  signalScore: number;
  quality: string;
  outcome: JournalOutcome;
  manualExitPrice: number | null;
  note: string;
  closedAt: number | null;
};

const STORAGE_KEY = "jaser:gold:journal:v1";

export function loadJournal(): JournalEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveJournal(entries: JournalEntry[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function addJournalEntry(input: Omit<JournalEntry, "id" | "loggedAt" | "outcome" | "manualExitPrice" | "note" | "closedAt">): JournalEntry[] {
  const entry: JournalEntry = {
    ...input,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    loggedAt: Date.now(),
    outcome: "open",
    manualExitPrice: null,
    note: "",
    closedAt: null,
  };
  const entries = [entry, ...loadJournal()];
  saveJournal(entries);
  return entries;
}

export function updateJournalEntry(id: string, patch: Partial<JournalEntry>): JournalEntry[] {
  const entries = loadJournal().map((e) => (e.id === id ? { ...e, ...patch, closedAt: patch.outcome && patch.outcome !== "open" ? Date.now() : e.closedAt } : e));
  saveJournal(entries);
  return entries;
}

export function removeJournalEntry(id: string): JournalEntry[] {
  const entries = loadJournal().filter((e) => e.id !== id);
  saveJournal(entries);
  return entries;
}

export function rMultipleFor(e: JournalEntry): number | null {
  if (e.entryPrice == null || e.stopLoss == null) return null;
  const risk = Math.abs(e.entryPrice - e.stopLoss);
  if (risk <= 0) return null;

  let exit: number | null = null;
  if (e.outcome === "tp1") exit = e.tp1;
  else if (e.outcome === "tp2") exit = e.tp2;
  else if (e.outcome === "tp3") exit = e.tp3;
  else if (e.outcome === "sl") exit = e.stopLoss;
  else if (e.outcome === "breakeven") exit = e.entryPrice;
  else if (e.outcome === "manual") exit = e.manualExitPrice;
  if (exit == null) return null;

  const reward = e.direction === "buy" ? exit - e.entryPrice : e.entryPrice - exit;
  return Number((reward / risk).toFixed(2));
}

export type JournalStats = { resolved: number; open: number; wins: number; losses: number; winRatePct: number | null; avgR: number | null };

export function computeJournalStats(entries: JournalEntry[]): JournalStats {
  const resolved = entries.filter((e) => e.outcome !== "open");
  const withR = resolved.map((e) => rMultipleFor(e)).filter((r): r is number => r != null);
  const wins = withR.filter((r) => r > 0).length;
  const losses = withR.filter((r) => r <= 0).length;
  return {
    resolved: resolved.length,
    open: entries.length - resolved.length,
    wins,
    losses,
    winRatePct: withR.length > 0 ? Number(((wins / withR.length) * 100).toFixed(1)) : null,
    avgR: withR.length > 0 ? Number((withR.reduce((s, r) => s + r, 0) / withR.length).toFixed(2)) : null,
  };
}
