// Documented provider capabilities — verified from each provider's own
// published docs, not assumed. "Free tier" never implies unlimited,
// low-latency, deep-history, or WebSocket access on its own; this file is
// the one place that states what's actually true for each provider this
// app talks to, so a future change (a plan upgrade, a provider dropping a
// feature) has one obvious place to update instead of scattered assumed
// comments across every call site.
//
// `lastVerified` is the date the capability facts below were last checked
// against the provider's own docs — not a live health check (see
// dataIssues/servedBy in marketData.ts for that; this file is static
// documentation, refreshed by a human/agent reading the docs again, not a
// runtime probe).

export type ProviderCapabilities = {
  id: string;
  instrument: "XAU/USD" | "macro" | "news";
  requiresKey: boolean;
  realTime: boolean;
  webSocket: boolean;
  historicalDepth: string;
  rateLimit: string;
  bidAsk: boolean;
  volume: boolean;
  notes: string[];
  lastVerified: string;
};

export const PROVIDER_REGISTRY: ProviderCapabilities[] = [
  {
    id: "gold-api.com",
    instrument: "XAU/USD",
    requiresKey: false,
    realTime: true,
    webSocket: false,
    historicalDepth: "لا يوجد تاريخ عميق موثوق على الخطة المجانية — يُستخدم فقط كسعر لحظي (quote)، ليس مصدر بيانات تاريخية.",
    rateLimit: "يعلن عدم وجود حد طلبات على سعره اللحظي المجاني — غير موثّق رسمياً بأرقام صريحة، غير مؤكد بشكل مستقل.",
    bidAsk: false,
    volume: false,
    notes: ["مصدر REST بسيط، بدون WebSocket. مصدر السعر الأساسي حالياً لأنه بدون مفتاح وبدون حد طلبات معلن."],
    lastVerified: "2026-08-16",
  },
  {
    id: "TwelveData",
    instrument: "XAU/USD",
    requiresKey: true,
    realTime: false,
    webSocket: true,
    historicalDepth: "~5000 شمعة لكل طلب time_series واحد؛ عمق أكبر يحتاج ترقيم صفحات عبر end_date (غير محقّق live بعد في هذا المشروع).",
    rateLimit: "الخطة المجانية: 8 طلبات/دقيقة، 800 طلب/يوم. WebSocket الحقيقي (real-time streaming) مقيّد بخطط مدفوعة (Grow فما فوق) — غير متاح على المجانية.",
    bidAsk: false,
    volume: true,
    notes: [
      "المصدر الأساسي للشموع التاريخية والاحتياطي للسعر اللحظي.",
      "REST فقط على الخطة الحالية (المجانية) — لا streaming حقيقي بدون ترقية مدفوعة.",
    ],
    lastVerified: "2026-08-16",
  },
  {
    id: "Finnhub",
    instrument: "XAU/USD",
    requiresKey: true,
    realTime: false,
    webSocket: true,
    historicalDepth: "غير محقّق بشكل مستقل في هذا المشروع — يُستخدم كمزوّد احتياطي ثالث فقط.",
    rateLimit: "خطة مجانية محدودة (أرقام دقيقة غير مؤكدة هنا) — WebSocket الحقيقي غالباً مقيّد بخطط مدفوعة، مثل TwelveData.",
    bidAsk: false,
    volume: false,
    notes: ["احتياطي ثالث فقط — يُستدعى فقط عند فشل gold-api.com وTwelveData معاً."],
    lastVerified: "2026-08-16",
  },
  {
    id: "OANDA",
    instrument: "XAU/USD",
    requiresKey: true,
    realTime: true,
    webSocket: true,
    historicalDepth: "~5000 شمعة/طلب عبر REST، ترقيم صفحات فعلي عبر cursor `to` (مبني في هذا المشروع، غير محقّق live بعد).",
    rateLimit: "حساب تجريبي (practice) مجاني، سعة أعلى بكثير من TwelveData المجانية — لكن التسجيل مقيّد جغرافياً في بعض الدول (مؤكد من المستخدم).",
    bidAsk: true,
    volume: true,
    notes: [
      "وسيط تداول حقيقي، ليس reseller بيانات — XAU/USD أداة تداول فعلية عندهم.",
      "غير متاح لهذا المستخدم بسبب قيود التسجيل الجغرافية — كل الكود هنا يتراجع تلقائياً لـ TwelveData عند غياب OANDA_API_TOKEN.",
    ],
    lastVerified: "2026-08-16",
  },
  {
    id: "Treasury.gov (fiscaldata / TreasuryDirect)",
    instrument: "macro",
    requiresKey: false,
    realTime: false,
    webSocket: false,
    historicalDepth: "بيانات عوائد يومية، تاريخ طويل.",
    rateLimit: "غير موثّق رسمياً، لم يُلحظ أي تقييد عملياً.",
    bidAsk: false,
    volume: false,
    notes: ["يُستخدم فقط لاتجاه عائد سندات 10 سنوات — ليس مصدر سعر ذهب مطلقاً."],
    lastVerified: "2026-08-16",
  },
  {
    id: "Frankfurter.app (EUR/USD proxy for DXY)",
    instrument: "macro",
    requiresKey: false,
    realTime: false,
    webSocket: false,
    historicalDepth: "بيانات يومية تاريخية متوفرة، تُستخدم هنا فقط لاتجاه قصير المدى.",
    rateLimit: "غير موثّق، مجاني وبدون مفتاح.",
    bidAsk: false,
    volume: false,
    notes: [
      "بديل تقريبي (proxy) لمؤشر الدولار DXY الحقيقي، ليس DXY فعلياً — EUR/USD معكوساً كاتجاه فقط، ليس نفس تركيبة سلة العملات الحقيقية لمؤشر DXY.",
    ],
    lastVerified: "2026-08-16",
  },
];

export function getProviderCapabilities(id: string): ProviderCapabilities | null {
  return PROVIDER_REGISTRY.find((p) => p.id === id) ?? null;
}
