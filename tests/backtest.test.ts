import { describe, expect, it } from "vitest";
import { runBacktest } from "../src/backtest.js";
import type { Candle } from "../src/types.js";

function candles(count: number): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index;
    return { timestamp: index * 900_000, open: close - 0.2, high: close + 0.5, low: close - 0.5, close, volume: 1000 + index };
  });
}

describe("runBacktest", () => {
  it("rejects a dataset without enough closed candles", () => {
    expect(() => runBacktest(candles(1), {
      initialBalanceUsdt: 1000, tradeSizeUsdt: 100, feeRate: 0.001, slippageRate: 0.001,
      stopLossRate: 0.01, takeProfitRate: 0.02,
    })).toThrow("at least two candles");
  });

  it("reports net return, fees, drawdown and Buy & Hold", () => {
    const result = runBacktest(candles(60), {
      initialBalanceUsdt: 1000, tradeSizeUsdt: 100, feeRate: 0.001, slippageRate: 0.001,
      stopLossRate: 0.01, takeProfitRate: 0.02, executionDelayCandles: 1,
    });
    expect(result.metrics.executionDelayCandles).toBe(1);
    expect(result.metrics.buyAndHoldEquityUsdt).toBeGreaterThan(1000);
    expect(result.metrics.totalFeesUsdt).toBeGreaterThanOrEqual(0);
    expect(result.metrics.maxDrawdownPercent).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.metrics.expectancyUsdt)).toBe(true);
  });
});
