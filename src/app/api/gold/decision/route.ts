import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import { cacheGet, cacheSet, cacheGetOrFetch } from "@/lib/cache";
import { fetchGoldCandles, fetchGoldQuote } from "@/lib/gold/providers/marketData";
import { fetchTreasuryYieldTrend } from "@/lib/gold/providers/treasury";
import { fetchDollarProxyTrend } from "@/lib/gold/providers/frankfurter";
import { fetchNextFomcDate, fetchNextBlsReleaseDate, fetchNextBeaReleaseDate, nextWeeklyJoblessClaimsDate } from "@/lib/gold/providers/economicCalendar";
import { classifyNewsRisk, type NewsEvent } from "@/lib/gold/newsRisk";
import { buildDecision } from "@/lib/gold/decision";
import { resampleCandles } from "@/lib/gold/resample";
import { loadConfigRegistry } from "@/lib/gold/configPersistence";
import type { Candle } from "@/lib/gold/types";

export const runtime = "nodejs";

// Tightened from 90s/20s: quote's primary source (gold-api.com) is
// keyless and documents no rate limit, so its TTL only needs to protect
// against hammering it pointlessly, not against a quota. Candles still go
// through TwelveData's 8-req/min free tier for most users (OANDA is the
// preferred candle source but is geo-restricted for this deployment), so
// 60s stays conservative: even if every single decision poll below misses
// this cache, that's at most 4 candle endpoints once every 60s ≈ 4
// req/min, comfortably under the 8/min ceiling with headroom for the
// cross-timeframe comparison's occasional coalesced bursts.
const CANDLES_TTL_MS = 60_000;
const QUOTE_TTL_MS = 8_000; // shared with /api/gold/quote's cache key
const MACRO_TTL_MS = 6 * 60 * 60_000; // yields/FX move slowly; no need to refetch often
const CALENDAR_TTL_MS = 6 * 60 * 60_000; // release schedules don't change intraday
const CONFIG_REGISTRY_TTL_MS = 60_000; // Redis-persisted config registry — short cache so a real promotion (configPersistence.ts) shows up in live decisions within a minute, without a Redis round trip on every single request

// Beyond the existing soft warning (below, >90s just discloses staleness),
// this is the hard gate (spec §12/§40): past this age, the price is too
// old to safely derive an entry/SL/TP from, and the decision is forced to
// WAIT/NO_TRADE rather than just flagged.
const CRITICAL_PRICE_AGE_MS = 5 * 60_000;
// Multi-source price validation (spec §22): compares the live quote
// against the independently-fetched 5M candle series' own last close —
// no extra provider call, candles5m is already fetched every cycle.
const DISCREPANCY_SOFT_PCT = 1.5; // disclosed, doesn't block
const DISCREPANCY_HARD_PCT = 3; // forces WAIT — large enough that it's more likely a stale/wrong source than a real simultaneous price jump

// 4H and 30M are deliberately NOT fetched as their own provider calls.
// TwelveData's free plan caps requests per minute, and a single cold
// decision check used to fire 6 candle calls (4H/1H/30M/15M/5M/Daily) +
// 1 quote call in one burst — enough on its own to exhaust nearly the
// entire per-minute budget, which is exactly what was causing "تجاوز حد
// الطلبات" on the very first check of a session. 4H is a clean multiple
// of 1H and 30M is a clean multiple of 15M, so both are derived locally
// via resampleCandles() from a single larger fetch of the finer
// timeframe instead — same technique already used for the backtest
// engine's higher timeframes and for Finnhub's synthesized 4H. This cuts
// the candle-call count from 6 to 4 per check (33% fewer TwelveData
// requests) with no loss of real lookback: the finer fetch is sized so
// its own native use (the last N bars) is unchanged, and the *older*
// bars beyond that just feed the resample.
const NATIVE_1H_COUNT = 150; // unchanged from before — this is what 1H regime/structure actually reads
const FETCH_1H_COUNT = 500; // 500 / 4 = 125 4H bars ≥ the 120 we need, with the same last-150 tail still available for native 1H use
const NATIVE_15M_COUNT = 200; // unchanged from before — this is what 15M regime/structure actually reads
const FETCH_15M_COUNT = 340; // 340 / 2 = 170 30M bars ≥ the 150 we need, with the same last-200 tail still available for native 15M use

// Coalesced (not just cached): the cross-timeframe comparison fires up to
// 5 parallel /api/gold/decision requests, and every one of them needs
// these exact same series. Without coalescing, a cold cache means all 5
// see a miss at once and each fires its own provider call — 5x the real
// upstream requests for identical data, which is what trips a free-tier
// rate limit in a single burst.
//
// Stale fallback: if the live fetch itself gets rate-limited, serving
// the last real candles/quote this process actually fetched (flagged
// `stale`, disclosed below) beats blanking the whole decision to "no
// data" on every provider hiccup.
async function getCachedCandles(interval: Parameters<typeof fetchGoldCandles>[0], count: number) {
  const key = `gold:candles:${interval}:${count}`;
  const { value, stale } = await cacheGetOrFetch(key, CANDLES_TTL_MS, () => fetchGoldCandles(interval, count), (r) => r.status === "ok", 15 * 60_000);
  return stale ? { ...value, stale: true } : value;
}

async function getCachedQuote() {
  // Measures real wall-clock time for this call — near-zero on a cache
  // hit (accurate: no network round trip actually happened this request),
  // the real provider round trip on a miss. This is what marketState's
  // latencyMs reports below, not a guessed/assumed number.
  const t0 = Date.now();
  const { value, stale } = await cacheGetOrFetch("gold:quote", QUOTE_TTL_MS, () => fetchGoldQuote(), (r) => r.status === "ok", 3 * 60_000);
  const latencyMs = Date.now() - t0;
  return { ...value, stale, latencyMs };
}

async function getCachedConfigRegistry() {
  const { value } = await cacheGetOrFetch("gold:configRegistry:cache", CONFIG_REGISTRY_TTL_MS, () => loadConfigRegistry(), () => true);
  return value;
}

async function getCachedTreasuryTrend(tenor: "10 Yr" | "2 Yr"): Promise<"up" | "down" | "flat" | null> {
  const key = `gold:treasury:${tenor}`;
  const { value } = await cacheGetOrFetch(key, MACRO_TTL_MS, () => fetchTreasuryYieldTrend(tenor), (r) => r.status === "ok");
  return value.status === "ok" ? value.data.trend : null;
}

async function getCachedDollarTrend(): Promise<"up" | "down" | "flat" | null> {
  const key = "gold:dollarproxy";
  const { value } = await cacheGetOrFetch(key, MACRO_TTL_MS, () => fetchDollarProxyTrend(), (r) => r.status === "ok");
  return value.status === "ok" ? value.data.usdTrend : null;
}

async function getCachedNewsEvents(): Promise<{ events: NewsEvent[]; issues: string[] }> {
  const key = "gold:calendar";
  const cached = cacheGet<NewsEvent[]>(key);
  if (cached) return { events: cached, issues: [] };

  const inFlightKey = `${key}:inflight`;
  const { value: newsResults } = await cacheGetOrFetch(inFlightKey, 0, () => Promise.all([
    fetchNextFomcDate(),
    fetchNextBlsReleaseDate("Consumer Price Index", "BLS — CPI"),
    fetchNextBlsReleaseDate("Employment Situation", "BLS — NFP"),
    fetchNextBeaReleaseDate("Gross Domestic Product", "BEA — GDP"),
    fetchNextBeaReleaseDate("Personal Income and Outlays", "BEA — PCE"),
  ]), () => false);
  const [fomc, cpi, nfp, gdp, pce] = newsResults;

  const events: NewsEvent[] = [];
  const issues: string[] = [];

  if (fomc.status === "ok") events.push({ name: "قرار الفيدرالي (FOMC)", time: fomc.data.date, importance: "extreme", source: "federalreserve.gov" });
  else if (fomc.status === "error") issues.push(`FOMC (federalreserve.gov): ${fomc.message}`);

  if (cpi.status === "ok") events.push({ name: "مؤشر أسعار المستهلك (CPI)", time: cpi.data.date, importance: "high", source: "bls.gov" });
  else if (cpi.status === "error") issues.push(`CPI (bls.gov): ${cpi.message}`);

  if (nfp.status === "ok") events.push({ name: "الوظائف غير الزراعية (NFP)", time: nfp.data.date, importance: "high", source: "bls.gov" });
  else if (nfp.status === "error") issues.push(`NFP (bls.gov): ${nfp.message}`);

  if (gdp.status === "ok") events.push({ name: "الناتج المحلي الإجمالي (GDP)", time: gdp.data.date, importance: "high", source: "bea.gov" });
  else if (gdp.status === "error") issues.push(`GDP (bea.gov): ${gdp.message}`);

  if (pce.status === "ok") events.push({ name: "مؤشر إنفاق المستهلك (PCE)", time: pce.data.date, importance: "high", source: "bea.gov" });
  else if (pce.status === "error") issues.push(`PCE (bea.gov): ${pce.message}`);

  // Deterministic — always succeeds, no parsing/network involved.
  events.push({ name: "طلبات إعانة البطالة الأسبوعية (Jobless Claims)", time: nextWeeklyJoblessClaimsDate(Date.now()), importance: "high", source: "dol.gov (جدول ثابت أسبوعي)" });

  if (events.length > 0) cacheSet(key, events, CALENDAR_TTL_MS);
  return { events, issues };
}

export async function GET(req: NextRequest) {
  const clientKey = getClientKey(req);
  const rl = checkRateLimit(`gold:${clientKey}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited. Try again shortly." }, { status: 429, headers: rl.retryAfterSeconds ? { "Retry-After": String(rl.retryAfterSeconds) } : undefined });
  }

  const [quote, c1h, c15m, c5m, cDaily] = await Promise.all([
    getCachedQuote(),
    getCachedCandles("1h", FETCH_1H_COUNT),
    getCachedCandles("15min", FETCH_15M_COUNT),
    getCachedCandles("5min", 200),
    getCachedCandles("1day", 30),
  ]);

  const dataIssues: string[] = [];
  const extract = (label: string, state: { status: string; stale?: boolean; servedBy?: string; [k: string]: any }): Candle[] | null => {
    if (state.status === "ok") {
      if (state.stale) dataIssues.push(`${label}: تجاوز حد الطلبات لدى المزوّد هذه المرة — تم استخدام آخر بيانات مؤكدة (قد تكون أقدم بدقائق) بدل تعطيل القرار بالكامل.`);
      // OANDA is the primary candle source (see marketData.ts); while
      // OANDA_API_TOKEN isn't set, every candle naturally falls through to
      // TwelveData — that's the expected default, not a fallback worth
      // flagging as an issue, so it only gets disclosed once OANDA is
      // actually configured and still lost out to a real failure.
      else if (state.servedBy === "TwelveData" && process.env.OANDA_API_TOKEN) dataIssues.push(`${label}: OANDA لم يستجب هذه المرة — تم الجلب من TwelveData بدلاً منه.`);
      else if (state.servedBy === "Finnhub") dataIssues.push(`${label}: OANDA وTwelveData غير متاحين هذه المرة — تم الجلب من مزوّد احتياطي ثالث (Finnhub) بدلاً منهما.`);
      return state.data as Candle[];
    }
    if (state.status === "missing_key") dataIssues.push(`${label}: مفتاح TWELVEDATA_API_KEY غير مضبوط`);
    else if (state.status === "rate_limited") dataIssues.push(`${label}: تجاوز حد الطلبات لدى المزوّد`);
    else if (state.status === "not_found") dataIssues.push(`${label}: لا توجد بيانات`);
    else dataIssues.push(`${label}: ${state.message ?? "خطأ غير معروف"}`);
    return null;
  };

  const fullCandles1h = extract("1H", c1h);
  const fullCandles15m = extract("15M", c15m);
  const candles5m = extract("5M", c5m);
  const dailyCandles = extract("Daily", cDaily);

  const candles1h = fullCandles1h ? fullCandles1h.slice(-NATIVE_1H_COUNT) : null;
  const candles15m = fullCandles15m ? fullCandles15m.slice(-NATIVE_15M_COUNT) : null;

  // Derived, not separately fetched (see NATIVE_/FETCH_ constants above) —
  // disclosed as an aggregation rather than hidden, same as Finnhub's own
  // 4H synthesis and the backtest engine's higher timeframes.
  const candles4h = fullCandles1h ? resampleCandles(fullCandles1h, 4).slice(-120) : null;
  if (!fullCandles1h) dataIssues.push("4H: يُشتق من بيانات 1H أعلاه — تعذّر الاشتقاق لعدم توفرها.");
  else if (candles4h && candles4h.length < 30) dataIssues.push("4H: بيانات كافية جزئياً فقط بعد التجميع من 1H (تغطية تاريخية قصيرة).");

  const candles30m = fullCandles15m ? resampleCandles(fullCandles15m, 2).slice(-150) : null;
  if (!fullCandles15m) dataIssues.push("30M: يُشتق من بيانات 15M أعلاه — تعذّر الاشتقاق لعدم توفرها.");
  else if (candles30m && candles30m.length < 30) dataIssues.push("30M: بيانات كافية جزئياً فقط بعد التجميع من 15M (تغطية تاريخية قصيرة).");

  // Tracked separately from `asOf` (server compute time): this is when the
  // provider itself last observed `price`, so real feed lag — a free-tier
  // delay, a stale-cache fallback, or the closed-5M-candle fallback below —
  // shows up honestly instead of being masked by a timestamp that only
  // proves the server ran, not that the price is current.
  let price: number | null = null;
  let priceAsOf: number | null = null;
  if (quote.status === "ok") {
    price = quote.data.price;
    priceAsOf = quote.data.timestamp;
    if ((quote as { stale?: boolean }).stale) {
      dataIssues.push("السعر اللحظي: تجاوز حد الطلبات لدى المزوّد هذه المرة — تم استخدام آخر سعر مؤكد (قد يكون أقدم بدقيقتين إلى ثلاث).");
    } else if ((quote as { servedBy?: string }).servedBy === "Finnhub") {
      dataIssues.push("السعر اللحظي: TwelveData رفض الطلب هذه المرة — تم الجلب تلقائياً من مزوّد احتياطي (Finnhub) بدلاً منه.");
    }
    // gold-api.com is the normal, expected source for the live price now
    // (see marketData.ts) — not a failure fallback, so it isn't logged as
    // a dataIssue. The candle-derived series (regime/structure/SL/TP) are
    // unaffected either way — those still come from TwelveData/Finnhub
    // exactly as before, and any trouble there is disclosed per-timeframe
    // below via `extract()`.
  } else if (candles5m && candles5m.length > 0) {
    const lastCandle = candles5m[candles5m.length - 1];
    price = lastCandle.close;
    priceAsOf = lastCandle.time;
    dataIssues.push("السعر اللحظي (quote) غير متاح — تم استخدام آخر إغلاق 5M بدلاً منه.");
  } else {
    dataIssues.push(quote.status === "missing_key" ? "السعر: مفتاح TWELVEDATA_API_KEY غير مضبوط" : "السعر اللحظي غير متاح");
  }

  const criticalStaleness: string[] = [];

  if (priceAsOf != null) {
    const ageMs = Date.now() - priceAsOf;
    const ageSeconds = Math.round(ageMs / 1000);
    if (ageSeconds > 90) {
      const ageLabel = ageSeconds >= 60 ? `${Math.round(ageSeconds / 60)} دقيقة` : `${ageSeconds} ثانية`;
      dataIssues.push(`تنبيه: السعر المستخدم أقدم من الوقت الفعلي بحوالي ${ageLabel} — قارنه مع سعر منصتك الفعلي قبل أي قرار دخول.`);
    }
    if (ageMs > CRITICAL_PRICE_AGE_MS) {
      criticalStaleness.push(
        `السعر المستخدم أقدم من ${Math.round(CRITICAL_PRICE_AGE_MS / 60_000)} دقائق (${Math.round(ageMs / 60_000)} دقيقة فعلياً) — بيانات قديمة جداً لاتخاذ قرار دخول آمن، تم فرض الانتظار.`
      );
    }
  }

  let priceDiscrepancyPct: number | null = null;
  if (price != null && candles5m && candles5m.length > 0) {
    const candleClose = candles5m[candles5m.length - 1].close;
    priceDiscrepancyPct = Math.abs((price - candleClose) / candleClose) * 100;
    if (priceDiscrepancyPct > DISCREPANCY_HARD_PCT) {
      criticalStaleness.push(
        `تعارض كبير بين مصدرين للسعر: اللحظي (${price.toFixed(2)}) يختلف عن آخر إغلاق شمعة 5M (${candleClose.toFixed(2)}) بنسبة ${priceDiscrepancyPct.toFixed(2)}% — تم فرض الانتظار لحين توضّح أي المصدرين صحيح.`
      );
    } else if (priceDiscrepancyPct > DISCREPANCY_SOFT_PCT) {
      dataIssues.push(`تفاوت ملحوظ بين مصدرين للسعر (${priceDiscrepancyPct.toFixed(2)}%) — لا يوقف القرار لكن يستحق انتباه.`);
    }
  }

  const feedStatus: "LIVE" | "DELAYED" | "STALE" | "CONFLICTED" | "UNAVAILABLE" =
    price == null
      ? "UNAVAILABLE"
      : priceDiscrepancyPct != null && priceDiscrepancyPct > DISCREPANCY_HARD_PCT
      ? "CONFLICTED"
      : priceAsOf != null && Date.now() - priceAsOf > CRITICAL_PRICE_AGE_MS
      ? "STALE"
      : priceAsOf != null && Date.now() - priceAsOf > 30_000
      ? "DELAYED"
      : "LIVE";

  const marketState = {
    source: (quote as { servedBy?: string }).servedBy ?? (price != null ? "5M candle fallback" : null),
    ageMs: priceAsOf != null ? Date.now() - priceAsOf : null,
    latencyMs: (quote as { latencyMs?: number }).latencyMs ?? null,
    feedStatus,
  };

  const [us10yTrend, dxyTrend, newsResult, configRegistry] = await Promise.all([
    getCachedTreasuryTrend("10 Yr"),
    getCachedDollarTrend(),
    getCachedNewsEvents(),
    getCachedConfigRegistry(),
  ]);
  if (us10yTrend === null) dataIssues.push("عائد سندات 10 سنوات (Treasury.gov): تعذّر الجلب هذه المرة — لا مفتاح مطلوب، غالباً مشكلة شبكة مؤقتة.");
  if (dxyTrend === null) dataIssues.push("مؤشر قوة الدولار (proxy عبر EUR/USD): تعذّر الجلب هذه المرة.");
  if (newsResult.events.length === 0) {
    dataIssues.push(newsResult.issues.length > 0 ? `تقويم الأخبار: ${newsResult.issues.join(" · ")}` : "تقويم الأخبار (FOMC/CPI/NFP): تعذّر الجلب هذه المرة.");
  }

  const newsRisk = classifyNewsRisk(newsResult.events, Date.now());

  const ALLOWED_PRIMARY_TF = new Set(["4H", "1H", "30M", "15M", "5M"]);
  const requestedTf = req.nextUrl.searchParams.get("tf")?.toUpperCase();
  const primaryTimeframe = (ALLOWED_PRIMARY_TF.has(requestedTf ?? "") ? requestedTf : "15M") as "4H" | "1H" | "30M" | "15M" | "5M";

  const decision = buildDecision({
    price,
    priceAsOf,
    candles4h,
    candles1h,
    candles30m,
    candles15m,
    candles5m,
    dailyCandles,
    macro: { us10yTrend, dxyTrend },
    dataIssues,
    newsRisk,
    primaryTimeframe,
    configRegistry,
    criticalStaleness,
  });

  return NextResponse.json({ ...decision, marketState });
}
