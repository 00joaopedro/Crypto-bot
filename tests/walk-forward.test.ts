import { describe, expect, it } from "vitest";
import { requiredWalkForwardWarmup, runWalkForward } from "../src/walk-forward.js";
import { BTC_REGIME_HISTORY } from "../src/btc-regime.js";
import type { Candle } from "../src/types.js";

const candles = (count: number): Candle[] => Array.from({ length: count }, (_, index) => {
  const close = 100 + index;
  return { timestamp: index * 900_000, open: close - 0.2, high: close + 0.5, low: close - 0.5, close, volume: 1000 + index };
});

describe("runWalkForward", () => {
  it("selects only from train data and evaluates later windows", () => {
    const result = runWalkForward(candles(120), {
      trainCandles: 60,
      testCandles: 20,
      candidates: [{ minimumSignalScore: 5 }, { minimumSignalScore: 6 }],
      base: { initialBalanceUsdt: 1000, tradeSizeUsdt: 100, feeRate: 0.001, slippageRate: 0.001, stopLossRate: 0.01, takeProfitRate: 0.02, qualityFilters: false },
    });
    expect(result.testedWindows).toBe(3);
    expect(result.windows[0]!.testStart).toBe(60);
    expect(result.windows[0]!.trainEnd).toBe(result.windows[0]!.testStart);
    expect(result.consistencyPercent).toBeGreaterThanOrEqual(0);
  });

  it("includes execution delay in regime and ATR warmup", () => {
    expect(requiredWalkForwardWarmup({ qualityFilters: true }, [{ btcRegimeFilter: true, executionDelayCandles: 3 }]))
      .toBe(BTC_REGIME_HISTORY + 3);
    expect(requiredWalkForwardWarmup({ qualityFilters: true }, [{ exitPolicy: { atrPeriod: 110 }, executionDelayCandles: 2 }]))
      .toBe(113);
  });

  it("rejects insufficient history", () => {
    expect(() => runWalkForward(candles(60), {
      trainCandles: 50, testCandles: 20, candidates: [{ minimumSignalScore: 5 }],
      base: { initialBalanceUsdt: 1000, tradeSizeUsdt: 100, feeRate: 0.001, slippageRate: 0.001, stopLossRate: 0.01, takeProfitRate: 0.02, qualityFilters: false },
    })).toThrow("trainCandles must be at least");
  });
});
