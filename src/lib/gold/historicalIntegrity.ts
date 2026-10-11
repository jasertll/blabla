import type { Candle, Timeframe } from "@/lib/gold/types";

// Verifies the pagination semantics of a fetched/accumulated candle series
// instead of silently trusting them — the deep-pagination fetchers (OANDA
// and TwelveData's fetchGoldCandlesDeep, and the historicalStore merge on
// top of them) rely on assumptions about how `to`/`end_date` cursors
// behave that have never been confirmed against a real API response
// (this sandbox can't reach either host). This runs on whatever series
// the backtest actually got, live, in production, and fails loudly if
// the assumptions turn out wrong instead of quietly producing a
// misleading history.

export type IntegrityReport = {
  timeframe: Timeframe;
  bars: number;
  oldest: number | null;
  newest: number | null;
  calendarSpanDays: number;
  duplicateBars: number;
  outOfOrder: number;
  unexpectedGaps: { fromTime: number; toTime: number; gapMinutes: number }[];
  valid: boolean;
  notes: string[];
};

const INTERVAL_MS: Record<Timeframe, number> = {
  "5min": 5 * 60_000,
  "15min": 15 * 60_000,
  "30min": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1day": 24 * 60 * 60_000,
};

// XAU/USD trades roughly Sun 22:00 UTC -> Fri 21:00/22:00 UTC
// (broker-dependent) — any gap touching Friday evening through Sunday
// evening UTC, or simply spanning more than ~40 hours outright, is a real
// market closure, not a data hole this check should flag.
function isExpectedMarketClosure(fromMs: number, toMs: number): boolean {
  const fromDay = new Date(fromMs).getUTCDay();
  const toDay = new Date(toMs).getUTCDay();
  return fromDay === 5 || fromDay === 6 || toDay === 0 || toDay === 6 || toMs - fromMs > 40 * 60 * 60_000;
}

export function buildIntegrityReport(candles: Candle[], timeframe: Timeframe): IntegrityReport {
  const notes: string[] = [];
  if (candles.length === 0) {
    return { timeframe, bars: 0, oldest: null, newest: null, calendarSpanDays: 0, duplicateBars: 0, outOfOrder: 0, unexpectedGaps: [], valid: false, notes: ["لا توجد شموع للتحقق منها."] };
  }

  const sorted = [...candles].sort((a, b) => a.time - b.time);

  let outOfOrder = 0;
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].time !== sorted[i].time) outOfOrder++;
  }

  const seen = new Set<number>();
  let duplicateBars = 0;
  for (const c of sorted) {
    if (seen.has(c.time)) duplicateBars++;
    seen.add(c.time);
  }

  const expectedInterval = INTERVAL_MS[timeframe];
  const gaps: IntegrityReport["unexpectedGaps"] = [];
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i].time - sorted[i - 1].time;
    if (diff > expectedInterval * 3 && !isExpectedMarketClosure(sorted[i - 1].time, sorted[i].time)) {
      gaps.push({ fromTime: sorted[i - 1].time, toTime: sorted[i].time, gapMinutes: Math.round(diff / 60_000) });
    }
  }

  const oldest = sorted[0].time;
  const newest = sorted[sorted.length - 1].time;
  const calendarSpanDays = Math.round((newest - oldest) / (24 * 60 * 60_000));

  if (outOfOrder > 0) notes.push(`${outOfOrder} شمعة وصلت خارج الترتيب الزمني قبل الفرز هنا — يستحق تحقّق GPT من ترتيب صفحات الجلب.`);
  if (duplicateBars > 0) notes.push(`${duplicateBars} شمعة مكرّرة بنفس الطابع الزمني — مؤشر محتمل على تداخل بين صفحتين متتاليتين.`);
  if (gaps.length > 0) notes.push(`${gaps.length} فجوة زمنية غير متوقعة (خارج إغلاق نهاية الأسبوع المعتاد) — أول ${Math.min(gaps.length, 20)} مُدرجة أدناه.`);
  if (duplicateBars === 0 && gaps.length === 0 && outOfOrder === 0) notes.push("لا تكرار، لا فجوات غير متوقعة، لا اضطراب بالترتيب — السلسلة سليمة حسب هذا الفحص.");

  return {
    timeframe,
    bars: sorted.length,
    oldest,
    newest,
    calendarSpanDays,
    duplicateBars,
    outOfOrder,
    unexpectedGaps: gaps.slice(0, 20),
    valid: duplicateBars === 0 && gaps.length === 0,
    notes,
  };
}
