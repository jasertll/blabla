// The LBMA Gold Price is set twice a trading day, in London, via a real
// electronic auction (10:30 and 15:00 London time) that large physical
// and OTC gold positions are priced against — a well-documented,
// gold-specific volatility-spike window distinct from the FOMC/CPI/NFP
// macro releases newsRisk.ts already tracks. Deterministic and clock-only
// (Intl's timeZone-aware formatting handles the BST/GMT switch itself),
// so this never depends on a network fetch and can never be "unavailable"
// the way a fetched calendar event can.
const FIX_TIMES_LONDON = [
  { hour: 10, minute: 30, label: "تثبيت سعر الذهب الصباحي (LBMA AM Fix، 10:30 لندن)" },
  { hour: 15, minute: 0, label: "تثبيت سعر الذهب المسائي (LBMA PM Fix، 15:00 لندن)" },
];

function londonHourMinute(ms: number): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = fmt.formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { hour, minute };
}

/**
 * True within `windowMinutes` of either daily LBMA fix. A narrow ±10
 * minute default — wide enough to catch the real spike community
 * references describe, narrow enough that it doesn't meaningfully cut
 * into trading opportunity across a full session (gold fixes happen
 * twice a day, every day, unlike the comparatively rare FOMC/CPI/NFP
 * blackouts).
 */
export function nearGoldFixWindow(now: number, windowMinutes = 10): { active: boolean; label: string | null } {
  const { hour, minute } = londonHourMinute(now);
  const nowMinutes = hour * 60 + minute;
  for (const fix of FIX_TIMES_LONDON) {
    const fixMinutes = fix.hour * 60 + fix.minute;
    if (Math.abs(nowMinutes - fixMinutes) <= windowMinutes) return { active: true, label: fix.label };
  }
  return { active: false, label: null };
}
