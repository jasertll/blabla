import type { ProviderState } from "@/lib/osintTypes";
import type { Candle, Timeframe } from "@/lib/gold/types";
import * as twelveData from "@/lib/gold/providers/twelveData";
import * as finnhub from "@/lib/gold/providers/finnhub";
import * as goldApi from "@/lib/gold/providers/goldApi";
import * as oanda from "@/lib/gold/providers/oanda";

// The one place that knows there are two interchangeable gold-price
// providers. Everything else (the API routes, the decision engine) calls
// these two functions and never imports twelveData/finnhub directly —
// swapping in a third provider later, or reordering primary/secondary,
// only touches this file.
//
// Finnhub only gets called when TwelveData (primary) actually fails —
// rate-limited, erroring, or its key missing. This isn't "run both and
// pick one," it's a real failover: on a normal day this file costs
// exactly the same TwelveData-only credit usage as before.

export type MarketDataResult<T> = ProviderState<T> & { servedBy?: "TwelveData" | "Finnhub" | "gold-api.com" | "OANDA" };

function usable<T>(state: ProviderState<T>): boolean {
  return state.status === "ok";
}

// Turns any failed ProviderState into one short, readable phrase — used
// to build a combined message when BOTH providers fail. Silently keeping
// only the primary's reason in that case (the previous behavior) hid
// whatever was actually wrong with the secondary — e.g. a bad
// FINNHUB_API_KEY would look identical to "Finnhub was never tried."
function describeFailure(state: ProviderState<unknown>): string {
  switch (state.status) {
    case "missing_key":
      return `${state.provider}: مفتاح ${state.envVar} غير مضبوط`;
    case "rate_limited":
      return `${state.provider}: تجاوز حد الطلبات`;
    case "not_found":
      return `${state.provider}: لا توجد بيانات`;
    case "error":
      return `${state.provider}: ${state.message}`;
    default:
      return "unknown";
  }
}

function combinedFailure<T>(primary: ProviderState<T>, secondary: ProviderState<T>): ProviderState<T> {
  return { status: "error", provider: "TwelveData+Finnhub", message: `${describeFailure(primary)} | ${describeFailure(secondary)}` };
}

function combinedCandleFailure<T>(first: ProviderState<T>, second: ProviderState<T>, third: ProviderState<T>): ProviderState<T> {
  return {
    status: "error",
    provider: "OANDA+TwelveData+Finnhub",
    message: `${describeFailure(first)} | ${describeFailure(second)} | ${describeFailure(third)}`,
  };
}

// The live price and the candle history are deliberately NOT prioritized
// the same way. Candles can only come from TwelveData/Finnhub — nothing
// else in this file has historical OHLC at all — so those two stay
// primary/secondary there. But the plain "current price" (the fast
// ticker, and the number the decision engine reads before doing its own
// candle-based math) doesn't need TwelveData-grade precision, and it was
// exactly the routine, high-frequency polling that kept eating into
// TwelveData's shared daily quota — the same quota the candle fetches
// need far more, since nothing else can supply those. Trying the free,
// keyless, uncapped source FIRST for quote keeps that entire category of
// calls off TwelveData/Finnhub's budget on a normal day, leaving more of
// it for what only they can do.
export async function fetchGoldQuote(): Promise<MarketDataResult<{ price: number; bid: number | null; ask: number | null; timestamp: number }>> {
  const free = await goldApi.fetchGoldQuote();
  if (usable(free)) return { ...free, servedBy: "gold-api.com" };

  const primary = await twelveData.fetchGoldQuote();
  if (usable(primary)) return { ...primary, servedBy: "TwelveData" };

  const secondary = await finnhub.fetchGoldQuote();
  if (usable(secondary)) return { ...secondary, servedBy: "Finnhub" };

  return combinedFailure(primary, secondary);
}

// OANDA goes first for candles: it's a real broker (not a data reseller),
// XAU/USD is one of its actual tradable instruments, and its free demo
// account has request headroom built for trading bots rather than
// TwelveData's tight 8-requests/minute free-tier ceiling — the ceiling
// that was the direct cause of the "تجاوز حد الطلبات" bursts on a single
// decision check. TwelveData stays as the second layer (still solid for
// candle history on its own), Finnhub as the third. If OANDA_API_TOKEN
// isn't set, this falls straight through to TwelveData with no behavior
// change — the three-provider chain degrades the same way the two-provider
// one always has.
export async function fetchGoldCandles(interval: Timeframe, count = 120): Promise<MarketDataResult<Candle[]>> {
  const first = await oanda.fetchGoldCandles(interval, count);
  if (usable(first)) return { ...first, servedBy: "OANDA" };

  const second = await twelveData.fetchGoldCandles(interval, count);
  if (usable(second)) return { ...second, servedBy: "TwelveData" };

  const third = await finnhub.fetchGoldCandles(interval, count);
  if (usable(third)) return { ...third, servedBy: "Finnhub" };

  return combinedCandleFailure(first, second, third);
}

// Backtest-only: multi-page history (see oanda.ts/twelveData.ts for why
// this can't use the fast single-request path above). OANDA goes first
// when it's configured (broker-grade data, generous rate limit), but
// OANDA restricts practice-account signup by country — when that's not an
// option, TwelveData's own end_date pagination reaches the same depth
// using the key that's already configured for everything else in this
// file, no new account needed. Falls back to the old shallow single-
// request chain only if neither deep path is usable — still works, just
// honestly shallower, exactly like before either of these existed.
export async function fetchGoldCandlesDeep(interval: Timeframe, maxPages = 6): Promise<MarketDataResult<Candle[]>> {
  const oandaDeep = await oanda.fetchGoldCandlesDeep(interval, maxPages);
  if (usable(oandaDeep)) return { ...oandaDeep, servedBy: "OANDA" };

  const twelveDataDeep = await twelveData.fetchGoldCandlesDeep(interval, maxPages);
  if (usable(twelveDataDeep)) return { ...twelveDataDeep, servedBy: "TwelveData" };

  return fetchGoldCandles(interval, 5000);
}
