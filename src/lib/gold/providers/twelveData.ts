import type { ProviderState } from "@/lib/osintTypes";
import type { Candle, Timeframe } from "@/lib/gold/types";

// TwelveData free tier (twelvedata.com) — official, documented, requires a
// free-signup API key but costs $0. XAU/USD is listed under their Forex
// symbol set (gold-vs-dollar behaves like an FX pair for data purposes),
// which the free plan covers. Rate limit: 8 requests/minute, 800/day on
// the free plan — the API route caches responses so one decision refresh
// doesn't burn the whole budget.
//
// This is one interchangeable implementation of a MarketDataProvider —
// nothing else in lib/gold/ imports twelvedata.com directly, only this
// module's exported functions.

const BASE = "https://api.twelvedata.com";
const SYMBOL = "XAU/USD";

function envKey(): string | null {
  const key = process.env.TWELVEDATA_API_KEY;
  return key && key.trim().length > 0 ? key.trim() : null;
}

// TwelveData returns HTTP 429 for BOTH a one-minute burst and a fully
// exhausted daily quota — reading only the status code makes them look
// identical, but they call for completely different responses (retry in
// a minute, vs nothing will work again until tomorrow). The response body
// carries the real wording either way, so read it even on a 429 instead
// of returning before ever seeing it.
function classifyLimitResponse(msg: string): ProviderState<never> {
  if (/\bday\b|\bdaily\b/i.test(msg)) return { status: "error", provider: "TwelveData", message: msg || "Daily API quota exhausted." };
  return { status: "rate_limited", provider: "TwelveData" };
}

export async function fetchGoldCandles(interval: Timeframe, count = 120): Promise<ProviderState<Candle[]>> {
  const apiKey = envKey();
  if (!apiKey) return { status: "missing_key", provider: "TwelveData", envVar: "TWELVEDATA_API_KEY" };

  try {
    const url = `${BASE}/time_series?symbol=${encodeURIComponent(SYMBOL)}&interval=${interval}&outputsize=${count}&order=ASC&apikey=${apiKey}`;
    const res = await fetch(url, { cache: "no-store" });

    if (res.status === 429) {
      const body = await res.json().catch(() => null);
      return classifyLimitResponse(String(body?.message ?? ""));
    }
    if (!res.ok) return { status: "error", provider: "TwelveData", message: `HTTP ${res.status}` };

    const json = await res.json();

    if (json.status === "error" || json.code) {
      const msg = String(json.message ?? "");
      if (/limit/i.test(msg)) return classifyLimitResponse(msg);
      return { status: "error", provider: "TwelveData", message: msg || "Unknown provider error." };
    }

    const values = Array.isArray(json.values) ? json.values : [];
    if (values.length === 0) return { status: "not_found", provider: "TwelveData" };

    const candles: Candle[] = values.map((v: any) => ({
      time: new Date(v.datetime.replace(" ", "T") + "Z").getTime(),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: v.volume != null ? parseFloat(v.volume) : null,
    }));

    return { status: "ok", data: candles };
  } catch {
    return { status: "error", provider: "TwelveData", message: "Network error reaching TwelveData." };
  }
}

// Deep, paginated history for the backtest engine — the TwelveData
// equivalent of oanda.ts's fetchGoldCandlesDeep(), for when OANDA isn't
// usable at all (e.g. geo-restricted account signup). A single time_series
// call tops out around 5000 candles regardless of outputsize; this walks
// further back via `end_date`, one page at a time, using the SAME key
// that's already configured for everything else in this file — no new
// account needed. Each time_series call costs 1 API credit on the free
// plan regardless of outputsize, so 6 sequential pages once (cached 24h
// by the caller) is a trivial fraction of the 800/day budget — this is
// deliberately NEVER called from the fast live-decision path, only from
// the backtest route, and pages sequentially (not in parallel) to respect
// the 8-requests/minute ceiling.
function formatEndDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 19).replace("T", " ");
}

export async function fetchGoldCandlesDeep(interval: Timeframe, maxPages = 6): Promise<ProviderState<Candle[]>> {
  const apiKey = envKey();
  if (!apiKey) return { status: "missing_key", provider: "TwelveData", envVar: "TWELVEDATA_API_KEY" };

  let all: Candle[] = [];
  let endDate: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const endParam = endDate ? `&end_date=${encodeURIComponent(endDate)}` : "";
    const url = `${BASE}/time_series?symbol=${encodeURIComponent(SYMBOL)}&interval=${interval}&outputsize=5000${endParam}&apikey=${apiKey}`;

    try {
      const res = await fetch(url, { cache: "no-store" });

      if (res.status === 429) {
        const body = await res.json().catch(() => null);
        const state = classifyLimitResponse(String(body?.message ?? ""));
        if (page === 0) return state;
        break; // keep whichever earlier (newer) pages already succeeded
      }
      if (!res.ok) {
        if (page === 0) return { status: "error", provider: "TwelveData", message: `HTTP ${res.status}` };
        break;
      }

      const json = await res.json();
      if (json.status === "error" || json.code) {
        const msg = String(json.message ?? "");
        if (page === 0) {
          if (/limit/i.test(msg)) return classifyLimitResponse(msg);
          return { status: "error", provider: "TwelveData", message: msg || "Unknown provider error." };
        }
        break;
      }

      const values = Array.isArray(json.values) ? json.values : [];
      if (values.length === 0) break; // no more history behind this point

      const pageCandles: Candle[] = values
        .map((v: any) => ({
          time: new Date(v.datetime.replace(" ", "T") + "Z").getTime(),
          open: parseFloat(v.open),
          high: parseFloat(v.high),
          low: parseFloat(v.low),
          close: parseFloat(v.close),
          volume: v.volume != null ? parseFloat(v.volume) : null,
        }))
        .sort((a: Candle, b: Candle) => a.time - b.time); // never assume the API's own ordering

      all = [...pageCandles, ...all];
      // Next page ends 1s before the earliest bar just fetched, so pages
      // never overlap and never skip a bar between them.
      endDate = formatEndDate(pageCandles[0].time - 1000);

      if (values.length < 4990) break; // fewer than requested — reached the start of available history
    } catch {
      if (page === 0) return { status: "error", provider: "TwelveData", message: "Network error reaching TwelveData." };
      break;
    }
  }

  if (all.length === 0) return { status: "not_found", provider: "TwelveData" };
  return { status: "ok", data: all };
}

export async function fetchGoldQuote(): Promise<ProviderState<{ price: number; bid: number | null; ask: number | null; timestamp: number }>> {
  const apiKey = envKey();
  if (!apiKey) return { status: "missing_key", provider: "TwelveData", envVar: "TWELVEDATA_API_KEY" };

  try {
    const url = `${BASE}/quote?symbol=${encodeURIComponent(SYMBOL)}&apikey=${apiKey}`;
    const res = await fetch(url, { cache: "no-store" });

    if (res.status === 429) {
      const body = await res.json().catch(() => null);
      return classifyLimitResponse(String(body?.message ?? ""));
    }
    if (!res.ok) return { status: "error", provider: "TwelveData", message: `HTTP ${res.status}` };

    const json = await res.json();
    if (json.status === "error" || json.code) {
      const msg = String(json.message ?? "");
      if (/limit/i.test(msg)) return classifyLimitResponse(msg);
      return { status: "error", provider: "TwelveData", message: msg || "Unknown provider error." };
    }
    if (!json.close) return { status: "not_found", provider: "TwelveData" };

    return {
      status: "ok",
      data: {
        price: parseFloat(json.close),
        bid: json.bid != null ? parseFloat(json.bid) : null,
        ask: json.ask != null ? parseFloat(json.ask) : null,
        timestamp: json.timestamp ? json.timestamp * 1000 : Date.now(),
      },
    };
  } catch {
    return { status: "error", provider: "TwelveData", message: "Network error reaching TwelveData." };
  }
}
