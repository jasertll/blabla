import type { Candle } from "@/lib/gold/types";

export type SessionName = "asian" | "london" | "new_york";

// Standard approximate UTC trading-session bands. Deliberately overlapping
// (London/NY overlap is the highest-liquidity window of the day) —
// these are widely-used conventions, not exact exchange hours.
const SESSION_BANDS: Record<SessionName, { startHour: number; endHour: number; label: string }> = {
  asian: { startHour: 0, endHour: 8, label: "الجلسة الآسيوية" },
  london: { startHour: 7, endHour: 16, label: "جلسة لندن" },
  new_york: { startHour: 12, endHour: 21, label: "جلسة نيويورك" },
};

// The London/NY overlap (12:00-16:00 UTC) is repeatedly cited across gold
// trading references as the single highest-liquidity, tightest-spread
// window of the day — worth calling out on its own rather than leaving
// the reader to notice "london and new_york are both active" themselves.
// Computed as the arithmetic intersection of the two bands above rather
// than a hardcoded 12/16, so it can never silently drift out of sync with
// them if those ever change.
const OVERLAP_LABEL = "تقاطع لندن-نيويورك (الأعلى سيولة)";
const OVERLAP_START = Math.max(SESSION_BANDS.london.startHour, SESSION_BANDS.new_york.startHour);
const OVERLAP_END = Math.min(SESSION_BANDS.london.endHour, SESSION_BANDS.new_york.endHour);

export type SessionRange = {
  session: string;
  label: string;
  active: boolean;
  open: number | null;
  high: number | null;
  low: number | null;
};

function rangeFor(
  session: string,
  label: string,
  startHour: number,
  endHour: number,
  candles5m: Candle[],
  now: number,
  utcHour: number,
  todayStart: number
): SessionRange {
  const active = utcHour >= startHour && utcHour < endHour;
  const sessionStart = todayStart + startHour * 60 * 60_000;
  const sessionEndCap = Math.min(now, todayStart + endHour * 60 * 60_000);
  const bars = candles5m.filter((c) => c.time >= sessionStart && c.time <= sessionEndCap);

  if (bars.length === 0) return { session, label, active, open: null, high: null, low: null };
  return {
    session,
    label,
    active,
    open: bars[0].open,
    high: Math.max(...bars.map((b) => b.high)),
    low: Math.min(...bars.map((b) => b.low)),
  };
}

// Cheap, per-timestamp session classification — no candle scanning, no
// open/high/low computation. Used by the backtest engine's spread model
// (thousands of calls per run) where analyzeSessions()'s full per-day
// range computation would be unnecessary overhead for just "which session
// band is this instant in." Shares the same SESSION_BANDS/overlap
// constants as analyzeSessions so the two can never silently disagree
// about what counts as London, NY, or the overlap.
export function classifyHourSession(utcMs: number): "overlap" | "london" | "new_york" | "asian" | "thin" {
  const utcHour = new Date(utcMs).getUTCHours() + new Date(utcMs).getUTCMinutes() / 60;
  if (utcHour >= OVERLAP_START && utcHour < OVERLAP_END) return "overlap";
  if (utcHour >= SESSION_BANDS.london.startHour && utcHour < SESSION_BANDS.london.endHour) return "london";
  if (utcHour >= SESSION_BANDS.new_york.startHour && utcHour < SESSION_BANDS.new_york.endHour) return "new_york";
  if (utcHour >= SESSION_BANDS.asian.startHour && utcHour < SESSION_BANDS.asian.endHour) return "asian";
  return "thin"; // roughly 21:00-24:00 UTC — after NY closes, before the Asian session opens; the thinnest-liquidity stretch of the day
}

export function analyzeSessions(candles5m: Candle[], now: number): SessionRange[] {
  const nowDate = new Date(now);
  const utcHour = nowDate.getUTCHours() + nowDate.getUTCMinutes() / 60;
  const todayStart = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate());

  const ranges = (Object.keys(SESSION_BANDS) as SessionName[]).map((session) =>
    rangeFor(session, SESSION_BANDS[session].label, SESSION_BANDS[session].startHour, SESSION_BANDS[session].endHour, candles5m, now, utcHour, todayStart)
  );
  ranges.push(rangeFor("overlap", OVERLAP_LABEL, OVERLAP_START, OVERLAP_END, candles5m, now, utcHour, todayStart));
  return ranges;
}
