import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import { cacheGet, cacheSet } from "@/lib/cache";
import { fetchGoldCandlesDeep } from "@/lib/gold/providers/marketData";
import { runBacktest, type BacktestResult } from "@/lib/gold/backtestEngine";
import { assessSufficiency } from "@/lib/gold/dataSufficiency";
import { bootstrapTradeMetrics } from "@/lib/gold/bootstrap";
import { assessRegimeBreakdown } from "@/lib/gold/validation";
import { accumulateCandles, historicalStoreStatus } from "@/lib/gold/historicalStore";
import { buildIntegrityReport } from "@/lib/gold/historicalIntegrity";
import { evaluatePromotions } from "@/lib/gold/configPersistence";

export const runtime = "nodejs";

// Long cache — a backtest run is expensive (up to 6 paginated historical
// fetches + walking the whole series, tens of thousands of bars when OANDA
// or the Redis-accumulated store is deep) and its result doesn't change
// until new bars accumulate, so there's no reason to redo it more than a
// couple of times a day even across many visits. The full response
// (including the integrity report and config-promotion log, both only
// computed on a real run) is what's cached now, not just the raw result —
// a cache hit should look identical to a fresh run, not a stripped-down
// version of one.
const BACKTEST_TTL_MS = 24 * 60 * 60_000;

// Matches buildDecision()'s default primaryTimeframe inside the backtest
// loop (backtestEngine.ts never passes primaryTimeframe, so every
// simulated entry is anchored to 15M) — promotion evidence belongs to
// that specific (timeframe, regime) bucket, not a guess.
const BACKTEST_TIMEFRAME = "15M";

function withEvidence(result: BacktestResult) {
  const sufficiency = assessSufficiency(result.trades.map((t) => ({ entryTime: t.entryTime, regimeAtEntry: t.regimeAtEntry })));
  const bootstrap = bootstrapTradeMetrics(result.trades.map((t) => t.rMultiple));
  const regimeBreakdown = assessRegimeBreakdown(result.trades.map((t) => ({ entryTime: t.entryTime, regimeAtEntry: t.regimeAtEntry, rMultiple: t.rMultiple })));
  return { ...result, sufficiency, bootstrap, regimeBreakdown };
}

export async function GET(req: NextRequest) {
  const clientKey = getClientKey(req);
  const rl = checkRateLimit(`gold-backtest:${clientKey}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited. Try again shortly." }, { status: 429 });
  }

  const cacheKey = "gold:backtest:5min:v2";
  const cached = cacheGet<Record<string, unknown>>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const fetched = await fetchGoldCandlesDeep("5min");
  if (fetched.status !== "ok") {
    const message =
      fetched.status === "missing_key"
        ? "لا يوجد مفتاح بيانات مضبوط (OANDA_API_TOKEN أو TWELVEDATA_API_KEY)."
        : fetched.status === "rate_limited"
        ? "تجاوز حد الطلبات لدى المزوّد — حاول بعد قليل."
        : fetched.status === "not_found"
        ? "لا توجد بيانات تاريخية متاحة."
        : fetched.message ?? "خطأ غير معروف.";
    return NextResponse.json({ error: message }, { status: 200 });
  }

  // Merge this run's fresh window into the durable Redis-backed store —
  // this is what makes historical depth actually accumulate across days
  // instead of resetting to whatever a single provider request/pagination
  // run can reach (see historicalStore.ts). Degrades to "just use the
  // fresh fetch" if Redis isn't configured or the merge fails.
  const storeStatus = historicalStoreStatus();
  const accumulated = await accumulateCandles(fetched.data);
  const candles5m = accumulated.length >= fetched.data.length ? accumulated : fetched.data;

  const integrityReport = buildIntegrityReport(candles5m, "5min");
  const result = runBacktest(candles5m);

  const promotion = await evaluatePromotions(
    BACKTEST_TIMEFRAME,
    result.trades.map((t) => ({ entryTime: t.entryTime, regimeAtEntry: t.regimeAtEntry, rMultiple: t.rMultiple }))
  );

  // servedBy tells the UI (and the caveats it renders) whether this run's
  // FRESH window used OANDA's deep multi-page history or fell back to a
  // single shallow fetch — candleCount/historicalStore below is the
  // combined depth actually used for the backtest, which can be larger
  // than the fresh fetch alone once the store has accumulated history.
  const response = {
    ...withEvidence(result),
    servedBy: fetched.servedBy ?? null,
    candleCount: candles5m.length,
    freshFetchCount: fetched.data.length,
    historicalStore: { configured: storeStatus.configured, accumulatedBars: storeStatus.configured ? accumulated.length : null },
    integrityReport,
    configPromotionLog: promotion.log,
  };

  cacheSet(cacheKey, response, BACKTEST_TTL_MS);
  return NextResponse.json(response);
}
