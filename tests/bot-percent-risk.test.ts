import { afterEach, expect, it, vi } from "vitest";
import { TradingBot } from "../src/bot.js";
import { PaperTrader } from "../src/paper-trader.js";
import { CentralTradeManager } from "../src/trade-manager.js";
import type { PublicMarketData } from "../src/market-data.js";
import type { BotPersistence, PersistedCycle } from "../src/persistence.js";
vi.mock("../src/strategy.js", () => ({ evaluateStrategy: () => ({ action: "BUY", score: 8 }) }));
vi.mock("../src/signal-ranking.js", () => ({ rankSignals: () => [{ symbol: "ETH/USDT", eligible: true, rank: 1, signal: { action: "BUY", score: 8 } }] }));
afterEach(() => vi.restoreAllMocks());
function setup(kind: "daily" | "drawdown", principal = true, boundary = .04, fail = false, baseline = true, second = false) {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const candles = Array.from({ length: 85 }, (_, i) => ({ timestamp: i * 900000, open: 100, high: 100.01, low: i === 84 ? 89 : 99.99, close: i === 84 ? 90 : 100, volume: 1 }));
  const config = { initialBalanceUsdt: 1000, tradeSizeUsdt: 500, feeRate: .001, slippageRate: 0, stopLossRate: .1, takeProfitRate: .2 };
  const paper = new PaperTrader(config), other = new PaperTrader(config), extra = new PaperTrader(config);
  const target = principal ? paper : other;
  target.processCandle(candles[83]!, true);
  if (second) extra.processCandle(candles[83]!, true);
  const manager = new CentralTradeManager({ maxConcurrentPositions: 10, maxExposurePercent: 1 });
  manager.recordEntry({ symbol: principal ? "BTC/USDT" : "SOL/USDT", notionalUsdt: 500, openedAt: candles[83]!.timestamp });
  if (second) manager.recordEntry({ symbol: "ADA/USDT", notionalUsdt: 500, openedAt: candles[83]!.timestamp });
  let paused = false, shouldFail = fail;
  const recordCycle = vi.fn(async (cycle: PersistedCycle) => {
    if (shouldFail) { shouldFail = false; throw new Error("database failure"); }
    if (cycle.riskPause || cycle.lossPause) paused = true;
  });
  const screenSpotSymbols = vi.fn(async () => ({ eligible: ["ETH/USDT"], blocked: {} }));
  const buy = vi.fn();
  const bot = new TradingBot({ active: "okx", fetchClosedCandles: async () => candles, screenSpotSymbols } as unknown as PublicMarketData, {
    symbol: "BTC/USDT", candleLimit: 85, signalScanSymbols: ["ETH/USDT"], minimumConfidence: .8, aiFailureMode: "quantitative", paperTrader: paper, tradeManager: manager,
    ...(kind === "daily" ? { maxDailyLossPercent: boundary } : { maxDrawdownPercent: boundary }),
    demoExecutor: { executeApprovedBuy: buy }, inspectDemoEntry: async () => ({ allowed: true }),
    persistence: {
      isPaused: async () => paused, readControlState: async () => ({ paused, revision: "42" }), recordCycle,
      ...(baseline ? { getDailyStartEquity: async () => 1000 } : {}),
      loadRecoveryState: async (symbol: string) => ({ symbol, lastProcessedCandle: candles[83]!.timestamp,
        paperState: (symbol === "ADA/USDT" ? extra : other).exportState() }),
    } as unknown as BotPersistence,
  });
  return { bot, target, manager, recordCycle, screenSpotSymbols, buy };
}
it.each(["daily", "drawdown"] as const)("persists %s breach before selecting another pair, without repeated pause requests", async kind => {
  const f = setup(kind);
  await f.bot.runCycle();
  expect(f.recordCycle).toHaveBeenCalledWith(expect.objectContaining({ symbol: "BTC/USDT", riskPause: { reason: kind === "daily" ? "paper_daily_loss_limit" : "paper_drawdown_limit", controlRevision: "42" } }));
  expect(f.target.hasOpenPosition).toBe(false);
  expect(f.screenSpotSymbols).not.toHaveBeenCalled();
  expect(f.buy).not.toHaveBeenCalled();
  const count = f.recordCycle.mock.calls.length;
  await f.bot.runCycle();
  expect(f.recordCycle).toHaveBeenCalledTimes(count);
});
it("applies the same percentage rule to a non-principal recovered position", async () => {
  const f = setup("daily", false);
  await f.bot.runCycle();
  expect(f.recordCycle).toHaveBeenCalledWith(expect.objectContaining({ symbol: "SOL/USDT", riskPause: expect.objectContaining({ reason: "paper_daily_loss_limit" }) }));
  expect(f.buy).not.toHaveBeenCalled();
});
it("uses pre-exit equity when no daily snapshot exists", async () => {
  const f = setup("daily", true, .04, false, false);
  await f.bot.runCycle();
  expect(f.recordCycle.mock.calls.some(([c]) => c.riskPause)).toBe(true);
});
it("keeps a loss below the configured percentage from creating a risk pause", async () => {
  const f = setup("daily", true, .1);
  await f.bot.runCycle();
  expect(f.recordCycle.mock.calls.some(([c]) => c.riskPause)).toBe(false);
  expect(f.screenSpotSymbols).toHaveBeenCalled();
});
it("rolls back the exit on a failed transaction and retries the risk pause", async () => {
  const f = setup("daily", true, .04, true);
  await expect(f.bot.runCycle()).rejects.toThrow("database failure");
  expect(f.target.hasOpenPosition).toBe(true);
  expect(f.screenSpotSymbols).not.toHaveBeenCalled();
  await f.bot.runCycle();
  expect(f.target.hasOpenPosition).toBe(false);
  expect(f.screenSpotSymbols).not.toHaveBeenCalled();
});
it("continues other existing exits after the first percentage breach without duplicate pause requests", async () => {
  const f = setup("daily", true, .04, false, true, true);
  await f.bot.runCycle();
  expect(f.manager.activePositions).toHaveLength(0);
  expect(f.recordCycle.mock.calls.filter(([c]) => c.riskPause)).toHaveLength(1);
  expect(f.screenSpotSymbols).not.toHaveBeenCalled();
});
