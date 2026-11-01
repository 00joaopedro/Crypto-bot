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
  const verifyDemoExecutionSafety = vi.fn().mockResolvedValueOnce({ status: "safe" }).mockResolvedValueOnce({ status: "safe" }).mockResolvedValueOnce({ status: "blocked", reason: "demo_position_without_live_protection" });
  const bot = new TradingBot(market, {
    symbol: "BTC/USDT", candleLimit: 85, minimumConfidence: 0.8, aiFailureMode: "quantitative",
    paperTrader: new PaperTrader({ initialBalanceUsdt: 1000, tradeSizeUsdt: 100, feeRate: 0.001, slippageRate: 0.0005, stopLossRate: 0.01, takeProfitRate: 0.02 }),
    persistence, demoExecutor: { executeApprovedBuy } as unknown as OkxDemoExecutor, verifyDemoExecutionSafety,
  });
  await bot.runCycle();
  expect(executeApprovedBuy).toHaveBeenCalledOnce();
  expect(verifyDemoExecutionSafety).toHaveBeenCalledTimes(3);
  expect(setPaused).toHaveBeenCalledWith(true, "system:demo_execution_safety");
  await bot.runCycle();
  expect(executeApprovedBuy).toHaveBeenCalledOnce();
  verifyDemoExecutionSafety.mockResolvedValue({ status: "safe" });
  bot.clearDemoExecutionBlock();
  await bot.runCycle();
  expect(verifyDemoExecutionSafety).toHaveBeenCalledTimes(4);
  expect(executeApprovedBuy).toHaveBeenCalledOnce();
  vi.restoreAllMocks();
});
