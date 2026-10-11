export type NewsEvent = { name: string; time: number; importance: "high" | "extreme"; source: string };

export type NewsRiskAssessment = {
  level: "low" | "medium" | "high" | "extreme" | "unavailable";
  nextEvent: NewsEvent | null;
  minutesUntil: number | null;
  inBlackout: boolean;
  blackoutReason: string | null;
};

// Per the original design brief: default blackout 30-60 min before a
// major release, 15-30 min after; up to 120 min around extreme events
// (FOMC decision + press conference). These are the concrete minutes
// chosen within those ranges.
const BEFORE_MINUTES: Record<NewsEvent["importance"], number> = { high: 45, extreme: 90 };
const AFTER_MINUTES: Record<NewsEvent["importance"], number> = { high: 20, extreme: 90 };

export function classifyNewsRisk(events: NewsEvent[], now: number): NewsRiskAssessment {
  if (events.length === 0) {
    return { level: "unavailable", nextEvent: null, minutesUntil: null, inBlackout: false, blackoutReason: null };
  }

  let closest: NewsEvent | null = null;
  let closestDelta = Infinity;
  for (const e of events) {
    const delta = Math.abs(e.time - now);
    if (delta < closestDelta) {
      closestDelta = delta;
      closest = e;
    }
  }
  if (!closest) {
    return { level: "unavailable", nextEvent: null, minutesUntil: null, inBlackout: false, blackoutReason: null };
  }

  const upcoming = events.filter((e) => e.time > now).sort((a, b) => a.time - b.time)[0] ?? null;
  const minutesUntil = upcoming ? Math.round((upcoming.time - now) / 60_000) : null;

  const before = BEFORE_MINUTES[closest.importance];
  const after = AFTER_MINUTES[closest.importance];
  const minutesFromEvent = (now - closest.time) / 60_000; // negative = before the event, positive = after it
  const inBlackout = minutesFromEvent >= -before && minutesFromEvent <= after;

  let level: NewsRiskAssessment["level"] = "low";
  if (inBlackout) level = closest.importance === "extreme" ? "extreme" : "high";
  else if (minutesUntil != null && minutesUntil <= 240) level = "medium";

  return {
    level,
    nextEvent: upcoming,
    minutesUntil,
    inBlackout,
    blackoutReason: inBlackout
      ? `${closest.name} (${closest.source}) ${minutesFromEvent < 0 ? `خلال ${Math.round(-minutesFromEvent)} دقيقة` : `منذ ${Math.round(minutesFromEvent)} دقيقة`} — ضمن نافذة حظر الأخبار.`
      : null,
  };
}
