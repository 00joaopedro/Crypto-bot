import { expect, it, vi } from "vitest";
import { TradingBot } from "../src/bot.js";
import { PaperTrader } from "../src/paper-trader.js";
import type { PublicMarketData } from "../src/market-data.js";
import type { BotPersistence } from "../src/persistence.js";
import type { OkxDemoExecutor } from "../src/okx-demo.js";

vi.mock("../src/strategy.js", () => ({ evaluateStrategy: (candles: Array<{ timestamp: number }>) => ({ action: "BUY", score: 8, scoreBreakdown: { trend: 2 }, candleTimestamp: candles.at(-1)?.timestamp }) }));

it("checks OKX safety before a buy and pauses when the new protection cannot be verified", async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const candles = Array.from({ length: 85 }, (_, i) => ({ timestamp: i * 900_000, open: 100, high: 101, low: 99, close: 100, volume: 1 }));
  const market = { fetchClosedCandles: vi.fn(async () => candles) } as unknown as PublicMarketData;
  const setPaused = vi.fn(async () => undefined);
  const persistence = { isPaused: async () => false, recordCycle: async () => undefined, setPaused, canEnterSymbol: async () => true } as unknown as BotPersistence;
  const executeApprovedBuy = vi.fn(async () => ({ status: "PLACED" as const, orderId: "1", clientOrderId: "CB1" }));
  const verifyDemoExecutionSafety = vi.fn().mockResolvedValue({ status: "safe" });
  const recordDemoOrder = vi.fn(async () => undefined);
  persistence.recordDemoOrder = recordDemoOrder;
  const verifyFilledDemoBuy = vi.fn(async () => {
    expect(recordDemoOrder).toHaveBeenCalledOnce();
    return { status: "blocked" as const, reason: "exit_quantity_not_covered" };
  });
  const bot = new TradingBot(market, {
    symbol: "BTC/USDT", candleLimit: 85, minimumConfidence: 0.8, aiFailureMode: "quantitative",
    paperTrader: new PaperTrader({ initialBalanceUsdt: 1000, tradeSizeUsdt: 100, feeRate: 0.001, slippageRate: 0.0005, stopLossRate: 0.01, takeProfitRate: 0.02 }),
    persistence, demoExecutor: { executeApprovedBuy } as unknown as OkxDemoExecutor, verifyDemoExecutionSafety, verifyFilledDemoBuy,
  });
  await bot.runCycle();
  expect(executeApprovedBuy).toHaveBeenCalledOnce();
  expect(verifyDemoExecutionSafety).toHaveBeenCalledTimes(2);
  expect(verifyFilledDemoBuy).toHaveBeenCalledWith({ symbol: "BTC/USDT", orderId: "1", clientOrderId: "CB1" });
  expect(setPaused).toHaveBeenCalledWith(true, "system:demo_execution_safety", "exit_quantity_not_covered");
  await bot.runCycle();
  expect(executeApprovedBuy).toHaveBeenCalledOnce();
  verifyDemoExecutionSafety.mockResolvedValue({ status: "safe" });
  bot.clearDemoExecutionBlock();
  await bot.runCycle();
  expect(verifyDemoExecutionSafety).toHaveBeenCalledTimes(3);
  expect(executeApprovedBuy).toHaveBeenCalledOnce();
  vi.restoreAllMocks();
});

it('admits Demo independently of an existing Paper position and applies the Demo gate again after restart', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const candles = Array.from({ length: 85 }, (_, i) => ({ timestamp: i * 900_000, open: 100, high: 100.1, low: 99.9, close: 100, volume: 1 }));
  const paper = new PaperTrader({ initialBalanceUsdt: 1000, tradeSizeUsdt: 100, feeRate: 0.001, slippageRate: 0, stopLossRate: 0.1, takeProfitRate: 0.2 });
  paper.processCandle(candles[83]!, true);
  const executeApprovedBuy = vi.fn(async () => ({ status: 'PLACED' as const, orderId: '1', clientOrderId: 'CB1' }));
  const inspectDemoEntry = vi.fn().mockResolvedValueOnce({ allowed: true }).mockResolvedValue({ allowed: false, reason: 'pending_demo_order' });
  const persistence = { isPaused: async () => false, recordCycle: async () => undefined, recordDemoOrder: async () => undefined, canEnterSymbol: async () => false } as unknown as BotPersistence;
  const options = { symbol: 'BTC/USDT', candleLimit: 85, minimumConfidence: 0.8, aiFailureMode: 'quantitative' as const, paperTrader: paper, persistence, entryCooldownMinutes: 60, inspectDemoEntry, demoExecutor: { executeApprovedBuy } as unknown as OkxDemoExecutor, verifyDemoExecutionSafety: async () => ({ status: 'safe' as const }) };
  const market = { fetchClosedCandles: async () => candles } as unknown as PublicMarketData;
  await new TradingBot(market, options).runCycle();
  expect(executeApprovedBuy).toHaveBeenCalledOnce();
  expect(paper.hasOpenPosition).toBe(true);
  await new TradingBot(market, options).runCycle();
  expect(inspectDemoEntry).toHaveBeenCalledTimes(2);
  expect(executeApprovedBuy).toHaveBeenCalledOnce();
  vi.restoreAllMocks();
});


it('persists and logs the numerical risk evidence before blocking entries without repeated pause alerts', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const riskEvidence = { scope: 'bot' as const, observedAt: Date.now(), equityUsdt: 4849,
    dayStartEquityUsdt: 5000, peakEquityUsdt: 5000, dailyLossRate: .0302, drawdownRate: .0302,
    maxDailyLoss: .03, maxDrawdown: .1 };
  const recordOperationalEvent = vi.fn(async () => undefined);
  const setPaused = vi.fn(async () => undefined);
  const executeApprovedBuy = vi.fn();
  const market = { fetchClosedCandles: vi.fn() } as unknown as PublicMarketData;
  const bot = new TradingBot(market, {
    symbol: 'BTC/USDT', candleLimit: 85, minimumConfidence: .8, aiFailureMode: 'quantitative',
    paperTrader: new PaperTrader({ initialBalanceUsdt: 1000, tradeSizeUsdt: 10, feeRate: .001,
      slippageRate: .0005, stopLossRate: .01, takeProfitRate: .02 }),
    persistence: { isPaused: async () => false, setPaused, recordOperationalEvent } as unknown as BotPersistence,
    demoExecutor: { executeApprovedBuy } as unknown as OkxDemoExecutor,
    verifyDemoExecutionSafety: async () => ({ status: 'blocked', reason: 'demo_daily_loss_limit', riskEvidence }),
  });
  try {
    await bot.runCycle();
    await bot.runCycle();
    expect(executeApprovedBuy).not.toHaveBeenCalled();
    expect(market.fetchClosedCandles).not.toHaveBeenCalled();
    expect(setPaused).toHaveBeenCalledOnce();
    expect(recordOperationalEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'DEMO_ENTRY_DECISION',
      details: expect.objectContaining({ reason: 'demo_daily_loss_limit', riskEvidence }) }));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"dailyLossRate":0.0302'));
  } finally { vi.restoreAllMocks(); }
});
