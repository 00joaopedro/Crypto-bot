import { TradingBot } from "./bot.js";
import type { PublicMarketData } from "./market-data.js";
import { PaperTrader } from "./paper-trader.js";

/** Synthetic transport only. No exchange is constructed and no order can be sent. */
export async function benchmarkUniverseScanner() {
  const rows = [];
  const end = Math.floor(Date.now() / 900000) * 900000 - 900000;
  const candles = Array.from({ length: 100 }, (_, i) => ({ timestamp: end - (99 - i) * 900000, open: 100, high: 100.01, low: 99.99, close: 100, volume: 1000 }));
  const pool = ["BTC/USDT", ...Array.from({ length: 499 }, (_, i) => `C${i}/USDT`)];
  const originalLog = console.log;
  console.log = () => undefined;
  try {
    for (const size of [15, 30, 50, 100, 200, 0]) {
      let calls = 0, active = 0, peak = 0, passes = 0;
      const market = {
        active: "okx", fetchClosedCandles: async () => candles,
        screenSpotSymbols: async () => ({ eligible: pool, blocked: {} }),
        fetchScanCandles: async () => {
          calls++; active++; peak = Math.max(peak, active);
          await Promise.resolve(); active--; return candles;
        },
      } as unknown as PublicMarketData;
      const bot = new TradingBot(market, {
        symbol: "BTC/USDT", candleLimit: 100, minimumConfidence: .8, dynamicUniverseSize: size,
        scanRequestBudget: 20, scanConcurrency: 2,
        paperTrader: new PaperTrader({ initialBalanceUsdt: 100, tradeSizeUsdt: 10, feeRate: .001, slippageRate: .0005, stopLossRate: .01, takeProfitRate: .02 }),
      });
      const started = performance.now();
      do {
        await bot.runCycle();
        passes++;
        if (passes > 100) throw new Error("Synthetic queue did not converge");
      } while (bot.getLastSignalScan()!.statistics!.pendingCandidates > 0);
      const scan = bot.getLastSignalScan()!;
      rows.push({ size, poolSize: pool.length, targetCandidates: scan.statistics!.targetCandidates,
        passes, candleRequests: calls, maximumConcurrentRequests: peak,
        localWallMs: Math.round((performance.now() - started) * 100) / 100,
        minimumLoopDelaySpanMs: (passes - 1) * 60000 });
    }
  } finally { console.log = originalLog; }
  return { status: "synthetic_scheduling_benchmark", requestBudget: 20, concurrency: 2, assumedLoopDelayMs: 60000,
    rows, limitations: ["Local CPU and fake transport only, not exchange or Railway latency.", "Loop-delay spans are lower bounds ignoring API time, retries, open-position supervision and other work.", "Actual scheduling may require more passes; every new candle invalidates cached analysis while preserving cursor fairness.", "No financial result or recommendation is inferred from synthetic candles."] };
}
