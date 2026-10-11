// Real evidence-sufficiency grading — no arbitrary "10,000 candles is
// enough" shortcut. Uses actual historical trades from the backtest
// engine: how many, over what time span, across how many distinct market
// regimes. These thresholds are explicitly guidelines (per the spec),
// not hard laws — but they're the honest gate before anything can move
// past BASELINE.

export type SufficiencyTier = "INSUFFICIENT" | "CANDIDATE_ELIGIBLE" | "PREFERRED" | "STRONG";

export type SufficiencyReport = {
  tier: SufficiencyTier;
  tradeCount: number;
  regimesRepresented: number;
  daySpan: number;
  notes: string[];
};

const THRESHOLDS = { candidate: 50, preferred: 100, strong: 250 };
const MIN_REGIME_DIVERSITY = 2;
const MIN_DAY_SPAN = 60;

export function assessSufficiency(trades: { entryTime: number; regimeAtEntry: string | null }[]): SufficiencyReport {
  const notes: string[] = [];
  const tradeCount = trades.length;
  const regimes = new Set(trades.map((t) => t.regimeAtEntry).filter((r): r is string => !!r));
  const times = trades.map((t) => t.entryTime);
  const daySpan = times.length > 1 ? Math.round((Math.max(...times) - Math.min(...times)) / (24 * 60 * 60_000)) : 0;

  let tier: SufficiencyTier = "INSUFFICIENT";
  if (tradeCount >= THRESHOLDS.strong) tier = "STRONG";
  else if (tradeCount >= THRESHOLDS.preferred) tier = "PREFERRED";
  else if (tradeCount >= THRESHOLDS.candidate) tier = "CANDIDATE_ELIGIBLE";

  if (tradeCount < THRESHOLDS.candidate) {
    notes.push(`عدد الصفقات (${tradeCount}) أقل من حد الترشّح الأدنى (${THRESHOLDS.candidate}) — أي تحسين الآن سيكون تحسين على ضجيج، مش نمط حقيقي.`);
  }
  if (tradeCount > 0 && regimes.size < MIN_REGIME_DIVERSITY) {
    notes.push(`تنوّع أنظمة السوق ضعيف (${regimes.size} فقط) — العيّنة قد تعكس ظرف سوق واحد وليست عامة.`);
  }
  if (tradeCount > 0 && daySpan < MIN_DAY_SPAN) {
    notes.push(`المدة الزمنية المغطاة (${daySpan} يوم) قصيرة — أقل من ${MIN_DAY_SPAN} يوم الموصى بها كحد أدنى لتنوّع زمني معقول.`);
  }
  if (tradeCount === 0) {
    notes.push("لا توجد صفقات محاكاة بعد — شغّل لوحة الاختبار التاريخي أولاً.");
  }

  return { tier, tradeCount, regimesRepresented: regimes.size, daySpan, notes };
}
