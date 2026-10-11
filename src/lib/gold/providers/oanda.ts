import type { ProviderState } from "@/lib/osintTypes";
import type { Candle, Timeframe } from "@/lib/gold/types";

// OANDA (oanda.com) — real forex broker, not a third-party data reseller.
// XAU/USD is one of their actual tradable instruments, and a free practice
// (demo) account gets a personal access token with no cost and no funding
// required. Its request limits are set up for algo-trading bots, not a
// handful of dashboard polls, so it's a genuinely higher-headroom source
// than TwelveData's 8-requests/minute free tier — see marketData.ts for
// where this sits in the failover order.
//
// Setup: create a free practice account at oanda.com, generate a personal
// access token from the account's API management page, and set
// OANDA_API_TOKEN in .env.local. The instrument-candles endpoint used here
// doesn't need an account ID (only account-scoped endpoints like pricing
// or orders do), so that's the only credential this provider needs.
//
// This is one interchangeable MarketDataProvider implementation — nothing
// outside marketData.ts imports this module directly.

const PROVIDER = "OANDA";
const INSTRUMENT = "XAU_USD";

// Practice (demo) environment by default — matches the free account type
// this integration is built for. A live account uses api-fxtrade.oanda.com
// instead; OANDA_ENV=live switches it for anyone who later trades for real.
function baseUrl(): string {
  return process.env.OANDA_ENV === "live" ? "https://api-fxtrade.oanda.com" : "https://api-fxpractice.oanda.com";
}

function envToken(): string | null {
  const key = process.env.OANDA_API_TOKEN;
  return key && key.trim().length > 0 ? key.trim() : null;
}

const GRANULARITY: Record<Timeframe, string> = {
  "5min": "M5",
  "15min": "M15",
  "30min": "M30",
  "1h": "H1",
  "4h": "H4",
  "1day": "D",
};

type OandaCandleResponse = {
  candles?: { time: string; volume: number; complete: boolean; mid?: { o: string; h: string; l: string; c: string } }[];
  errorMessage?: string;
};

async function fetchJson(url: string, token: string): Promise<{ ok: true; json: OandaCandleResponse } | { ok: false; state: ProviderState<never> }> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (res.status === 429) return { ok: false, state: { status: "rate_limited", provider: PROVIDER } };
    const json = (await res.json().catch(() => null)) as OandaCandleResponse | null;
    if (!res.ok) {
      // OANDA puts the real reason (bad token, unentitled instrument, bad
      // params) in `errorMessage` — HTTP status alone doesn't distinguish
      // "your token is wrong" from "your practice account isn't approved
      // for this instrument yet."
      const detail = json?.errorMessage ? String(json.errorMessage) : `HTTP ${res.status}`;
      return { ok: false, state: { status: "error", provider: PROVIDER, message: detail } };
    }
    if (!json) return { ok: false, state: { status: "error", provider: PROVIDER, message: "استجابة غير صالحة من OANDA." } };
    return { ok: true, json };
  } catch {
    return { ok: false, state: { status: "error", provider: PROVIDER, message: "Network error reaching OANDA." } };
  }
}

export async function fetchGoldCandles(interval: Timeframe, count = 120): Promise<ProviderState<Candle[]>> {
  const token = envToken();
  if (!token) return { status: "missing_key", provider: PROVIDER, envVar: "OANDA_API_TOKEN" };

  const granularity = GRANULARITY[interval];
  // Padded so that after dropping the still-forming (incomplete) final
  // candle below, at least `count` closed bars remain.
  const requestCount = Math.min(5000, count + 5);
  const url = `${baseUrl()}/v3/instruments/${INSTRUMENT}/candles?granularity=${granularity}&count=${requestCount}&price=M`;
  const result = await fetchJson(url, token);
  if (!result.ok) return result.state;

  const raw = result.json.candles ?? [];
  if (raw.length === 0) return { status: "not_found", provider: PROVIDER };

  const candles: Candle[] = raw
    .filter((c) => c.complete && c.mid)
    .map((c) => ({
      time: new Date(c.time).getTime(),
      open: parseFloat(c.mid!.o),
      high: parseFloat(c.mid!.h),
      low: parseFloat(c.mid!.l),
      close: parseFloat(c.mid!.c),
      volume: typeof c.volume === "number" ? c.volume : null,
    }));

  if (candles.length === 0) return { status: "not_found", provider: PROVIDER };
  return { status: "ok", data: candles.slice(-count) };
}

// Deep, paginated history for the backtest engine specifically — NOT used
// by the live decision route, which needs one fast call, not several
// sequential ones. A single OANDA request tops out at 5000 candles
// (~17-25 calendar days of 5-minute bars once weekend gaps are counted),
// which is exactly why the backtest/validation machinery in
// dataSufficiency.ts/validation.ts almost never clears its own 60-day/
// 50-trade minimum — it was only ever fed one page. This walks further
// back via OANDA's `to` cursor, one page at a time, prepending each page
// so the final series stays chronological. OANDA's practice-account rate
// limit (built for algo-trading bots) has real headroom for a handful of
// sequential requests; nothing else in this file does this, and this
// function is deliberately never called from the fast decision path.
export async function fetchGoldCandlesDeep(interval: Timeframe, maxPages = 6): Promise<ProviderState<Candle[]>> {
  const token = envToken();
  if (!token) return { status: "missing_key", provider: PROVIDER, envVar: "OANDA_API_TOKEN" };

  const granularity = GRANULARITY[interval];
  let all: Candle[] = [];
  let cursor: string | null = null; // "to" boundary for the next (older) page

  for (let page = 0; page < maxPages; page++) {
    const toParam = cursor ? `&to=${encodeURIComponent(cursor)}` : "";
    const url = `${baseUrl()}/v3/instruments/${INSTRUMENT}/candles?granularity=${granularity}&count=5000${toParam}&price=M`;
    const result = await fetchJson(url, token);

    if (!result.ok) {
      if (page === 0) return result.state; // first page failed — nothing to return at all
      break; // later page failed — keep whatever real pages we already got instead of discarding them
    }

    const raw = result.json.candles ?? [];
    const pageCandles: Candle[] = raw
      .filter((c) => c.complete && c.mid)
      .map((c) => ({
        time: new Date(c.time).getTime(),
        open: parseFloat(c.mid!.o),
        high: parseFloat(c.mid!.h),
        low: parseFloat(c.mid!.l),
        close: parseFloat(c.mid!.c),
        volume: typeof c.volume === "number" ? c.volume : null,
      }));

    if (pageCandles.length === 0) break; // no more history behind this point

    all = [...pageCandles, ...all];
    // Next page ends 1ms before the earliest bar we just got, so pages
    // never overlap and never skip a bar between them.
    cursor = new Date(pageCandles[0].time - 1).toISOString();

    // OANDA returned fewer than requested — that's the start of its
    // history for this instrument/granularity, no point paging further.
    if (pageCandles.length < 4990) break;
  }

  if (all.length === 0) return { status: "not_found", provider: PROVIDER };
  return { status: "ok", data: all };
}
