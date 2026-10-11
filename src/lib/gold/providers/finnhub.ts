import type { ProviderState } from "@/lib/osintTypes";
import type { Candle, Timeframe } from "@/lib/gold/types";
import { resampleCandles } from "@/lib/gold/resample";

// Finnhub (finnhub.io) — secondary/failover gold price source, used only
// when TwelveData (the primary provider) fails or is rate-limited. Free
// tier: documented 60 calls/minute, and its forex endpoints cover
// OANDA:XAU_USD without a paid plan. This is one interchangeable
// MarketDataProvider implementation — nothing outside app/api/gold/*
// imports this module directly, so a third provider can be added later
// the same way without touching the decision engine.
//
// Finnhub has no native 4H candle resolution, so 4H is synthesized by
// resampling fetched 1H bars (same technique the backtest engine uses to
// build higher timeframes from a single bulk fetch) — disclosed as an
// approximation, not hidden.

const BASE = "https://finnhub.io/api/v1";
const SYMBOL = "OANDA:XAU_USD";
const PROVIDER = "Finnhub";

function envKey(): string | null {
  const key = process.env.FINNHUB_API_KEY;
  return key && key.trim().length > 0 ? key.trim() : null;
}

const RESOLUTION_SECONDS: Record<string, number> = {
  "5": 5 * 60,
  "15": 15 * 60,
  "30": 30 * 60,
  "60": 60 * 60,
  D: 24 * 60 * 60,
};

// Maps our Timeframe to a Finnhub resolution, plus (for 4h) the base
// resolution + factor to resample from since Finnhub has no native 4H bar.
function resolutionFor(interval: Timeframe): { resolution: string; resampleFactor?: number } {
  switch (interval) {
    case "5min":
      return { resolution: "5" };
    case "15min":
      return { resolution: "15" };
    case "30min":
      return { resolution: "30" };
    case "1h":
      return { resolution: "60" };
    case "4h":
      return { resolution: "60", resampleFactor: 4 };
    case "1day":
      return { resolution: "D" };
  }
}

async function fetchJson(url: string): Promise<{ ok: true; json: any } | { ok: false; state: ProviderState<never> }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 429) return { ok: false, state: { status: "rate_limited", provider: PROVIDER } };
    if (!res.ok) {
      // Read the body even on failure — Finnhub puts the actual reason
      // (e.g. "Invalid API key") in a JSON `error` field, and "HTTP 401"
      // alone doesn't tell anyone whether the key is wrong, expired, or
      // just not entitled to this endpoint on the free plan.
      const body = await res.json().catch(() => null);
      const detail = body?.error ? String(body.error) : `HTTP ${res.status}`;
      return { ok: false, state: { status: "error", provider: PROVIDER, message: detail } };
    }
    const json = await res.json();
    if (json?.error) {
      const msg = String(json.error);
      if (/limit/i.test(msg)) return { ok: false, state: { status: "rate_limited", provider: PROVIDER } };
      return { ok: false, state: { status: "error", provider: PROVIDER, message: msg } };
    }
    return { ok: true, json };
  } catch {
    return { ok: false, state: { status: "error", provider: PROVIDER, message: "Network error reaching Finnhub." } };
  }
}

// Deliberately NOT using Finnhub's /quote endpoint here: that endpoint is
// documented as covering US equities, and forex symbols on the free tier
// have returned empty/zeroed responses from it in practice — a silent
// failure that would look like "not_found" with no clue why. /forex/candle
// is the endpoint this provider is already confirmed to serve XAU/USD
// through (see fetchGoldCandles below), so the "quote" here is just the
// most recent 1-minute bar's close from that same endpoint — one real
// code path instead of two, and no dependency on a possibly-restricted one.
export async function fetchGoldQuote(): Promise<ProviderState<{ price: number; bid: number | null; ask: number | null; timestamp: number }>> {
  const apiKey = envKey();
  if (!apiKey) return { status: "missing_key", provider: PROVIDER, envVar: "FINNHUB_API_KEY" };

  const to = Math.floor(Date.now() / 1000);
  const from = to - 2 * 60 * 60; // last 2 hours of 1-minute bars — comfortably covers any brief gap while staying a small request
  const url = `${BASE}/forex/candle?symbol=${encodeURIComponent(SYMBOL)}&resolution=1&from=${from}&to=${to}&token=${apiKey}`;
  const result = await fetchJson(url);
  if (!result.ok) return result.state;

  const { json } = result;
  if (json.s === "no_data" || !Array.isArray(json.t) || json.t.length === 0) {
    return { status: "not_found", provider: PROVIDER };
  }

  const lastIdx = json.t.length - 1;
  return {
    status: "ok",
    data: {
      price: json.c[lastIdx],
      bid: null,
      ask: null,
      timestamp: json.t[lastIdx] * 1000,
    },
  };
}

export async function fetchGoldCandles(interval: Timeframe, count = 120): Promise<ProviderState<Candle[]>> {
  const apiKey = envKey();
  if (!apiKey) return { status: "missing_key", provider: PROVIDER, envVar: "FINNHUB_API_KEY" };

  const { resolution, resampleFactor } = resolutionFor(interval);
  const barsNeeded = resampleFactor ? count * resampleFactor : count;
  const barSeconds = RESOLUTION_SECONDS[resolution] ?? 300;
  const to = Math.floor(Date.now() / 1000);
  // A generous multiplier over the raw bar span accounts for weekend/holiday
  // gaps in the forex calendar, where no candles exist to fill the window.
  const from = to - Math.ceil(barSeconds * barsNeeded * 2.2);

  const url = `${BASE}/forex/candle?symbol=${encodeURIComponent(SYMBOL)}&resolution=${resolution}&from=${from}&to=${to}&token=${apiKey}`;
  const result = await fetchJson(url);
  if (!result.ok) return result.state;

  const { json } = result;
  if (json.s === "no_data" || !Array.isArray(json.t) || json.t.length === 0) {
    return { status: "not_found", provider: PROVIDER };
  }

  let candles: Candle[] = json.t.map((t: number, i: number) => ({
    time: t * 1000,
    open: json.o[i],
    high: json.h[i],
    low: json.l[i],
    close: json.c[i],
    volume: Array.isArray(json.v) ? json.v[i] ?? null : null,
  }));

  if (resampleFactor) candles = resampleCandles(candles, resampleFactor);

  return { status: "ok", data: candles.slice(-count) };
}
