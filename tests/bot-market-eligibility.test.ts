import { afterEach, expect, it, vi } from "vitest";
import type { OkxDemoExecutor } from "../src/okx-demo.js";
import { TradingBot } from "../src/bot.js";
import { PublicMarketData } from "../src/market-data.js";
import { PaperTrader } from "../src/paper-trader.js";
import { CentralTradeManager } from "../src/trade-manager.js";
import { screenEntryMarkets, type MarketScreen } from "../src/market-eligibility.js";

vi.mock("../src/strategy.js", () => ({ evaluateStrategy: vi.fn(() => ({ action: "BUY", score: 8 })) }));
vi.mock("../src/signal-ranking.js", () => ({ rankSignals: (candidates: Array<{ symbol: string }>) => candidates.map(({ symbol }, i) => ({ symbol, eligible: true, rank: i + 1, signal: { action: "BUY", score: 8 } })) }));
afterEach(() => vi.restoreAllMocks());

function fixture({ open = false, fail = false, excluded = [] as string[], principal = "USDC/USDT" } = {}) {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const candles = Array.from({ length: 85 }, (_, i) => ({ timestamp: i * 900_000, open: 100, high: 100.01, low: i === 84 && open ? 80 : 99.99, close: 100, volume: 1 }));
  const symbols = ["USDC/USDT", "XNVDA/USDT", "ADA/USDT", "ETH/USDT"];
  const result = screenEntryMarkets(symbols.map(symbol => ({ symbol, spot: true, active: true, quote: "USDT" })), Object.fromEntries(symbols.map(symbol => [symbol, { bid: 99.99, ask: 100.01, last: 100, quoteVolume: 2e6 }])), { minQuoteVolume: 1e6, maxSpreadPercent: .15, excludedSymbols: excluded });
  const screenSpotSymbols = vi.fn(async (): Promise<MarketScreen> => {
    if (fail) throw new Error("ticker outage");
    return result;
  });
  const fetchClosedCandles = vi.fn(async () => candles);
  const paper = new PaperTrader({ initialBalanceUsdt: 1000, tradeSizeUsdt: 10, feeRate: 0, slippageRate: 0, stopLossRate: .1, takeProfitRate: .2 });
  const manager = new CentralTradeManager({ maxConcurrentPositions: 10, maxExposurePercent: 1 });
  if (open) {
    paper.processCandle(candles[83]!, true);
    manager.recordEntry({ symbol: principal, openedAt: candles[83]!.timestamp, notionalUsdt: 10 });
  }
  const executeApprovedBuy = vi.fn(async () => ({ status: "PLACED" as const, orderId: "1", clientOrderId: "CB1" }));
  const verifyDemoExecutionSafety = vi.fn(async () => ({ status: "safe" as const }));
  const market = { active: "okx", fetchClosedCandles, screenSpotSymbols } as unknown as PublicMarketData;
  const createBot = () => new TradingBot(market, {
    symbol: principal, signalScanSymbols: symbols, dynamicUniverseSize: 2,
    marketEligibility: { excludedSymbols: excluded }, candleLimit: 85, minimumConfidence: .8,
    paperTrader: paper, tradeManager: manager, aiFailureMode: "quantitative",
    inspectDemoEntry: async () => ({ allowed: true }),
    demoExecutor: { executeApprovedBuy } as unknown as OkxDemoExecutor, verifyDemoExecutionSafety,
  });
  return { createBot, paper, fetchClosedCandles, screenSpotSymbols, executeApprovedBuy, verifyDemoExecutionSafety };
}

it("screens fixed and dynamic candidates before candle requests and keeps ADA eligible", async () => {
  const f = fixture();
  const bot = f.createBot();
  await bot.runCycle();
  expect(bot.getLastSignalScan()?.pairs).toEqual(["ADA/USDT", "ETH/USDT"]);
  expect(f.fetchClosedCandles.mock.calls).not.toContainEqual(["XNVDA/USDT", 90]);
  // The principal pair's candles remain the clock; it cannot receive a new entry.
  expect(f.executeApprovedBuy).toHaveBeenCalledWith(expect.objectContaining({ symbol: "ADA/USDT" }));
  expect(f.paper.hasOpenPosition).toBe(false);
});

it("keeps excluded positions under Paper stop and Demo safety supervision", async () => {
  const f = fixture({ open: true });
  await f.createBot().runCycle();
  expect(f.paper.hasOpenPosition).toBe(false);
  expect(f.paper.exportState().closedTrades).toBe(1);
  expect(f.verifyDemoExecutionSafety).toHaveBeenCalled();
});

it("fails closed on discovery failure while still processing existing exits", async () => {
  const f = fixture({ open: true, fail: true, principal: "ADA/USDT" });
  await f.createBot().runCycle();
  expect(f.paper.hasOpenPosition).toBe(false);
  expect(f.executeApprovedBuy).not.toHaveBeenCalled();
});

it("does not reopen an excluded managed pair or fall back to the principal BUY", async () => {
  const f = fixture({ excluded: ["ADA/USDT", "ETH/USDT"] });
  const bot = f.createBot();
  await bot.runCycle();
  expect(bot.getLastSignalScan()?.pairs).toEqual([]);
  expect(f.paper.hasOpenPosition).toBe(false);
  expect(f.executeApprovedBuy).not.toHaveBeenCalled();
});

it("caches screening within the candle and rechecks after restart", async () => {
  const f = fixture();
  const bot = f.createBot();
  await bot.runCycle();
  await bot.runCycle();
  expect(f.screenSpotSymbols).toHaveBeenCalledTimes(1);
  await f.createBot().runCycle();
  expect(f.screenSpotSymbols).toHaveBeenCalledTimes(2);
});

it("blocks an otherwise eligible principal during an outage and retries the screen", async () => {
  const f = fixture({ principal: "ADA/USDT" });
  f.screenSpotSymbols.mockRejectedValueOnce(new Error("temporary outage"));
  const bot = f.createBot();
  await bot.runCycle();
  expect(f.paper.hasOpenPosition).toBe(false);
  expect(f.executeApprovedBuy).not.toHaveBeenCalled();
  await bot.runCycle();
  expect(f.screenSpotSymbols).toHaveBeenCalledTimes(2);
  expect(bot.getLastSignalScan()?.pairs).toContain("ADA/USDT");
});

it("continues stops after an operator explicitly excludes a previously opened crypto", async () => {
  const f = fixture({ open: true, principal: "ADA/USDT", excluded: ["ADA/USDT"] });
  await f.createBot().runCycle();
  expect(f.paper.hasOpenPosition).toBe(false);
  expect(f.executeApprovedBuy).not.toHaveBeenCalledWith(expect.objectContaining({ symbol: "ADA/USDT" }));
});
