import { describe, expect, it, vi } from "vitest";
import { runBacktest } from "../src/backtest.js";
import { validateDemoStrategy } from "../src/strategy-validation.js";
import type { Candle } from "../src/types.js";

vi.mock("../src/strategy.js", () => ({ evaluateStrategy: (candles: Candle[]) => ({ action: candles.length === 51 ? "BUY" : candles.length === 53 ? "SELL" : "HOLD" }) }));

const candles = (count: number): Candle[] => Array.from({ length: count }, (_, i) => ({ timestamp: i * 900_000, open: 100, high: 101, low: 99, close: 100, volume: 10 }));
const base = { initialBalanceUsdt: 1000, tradeSizeUsdt: 100, feeRate: 0.001, slippageRate: 0.001, stopLossRate: 0.2, takeProfitRate: 0.2 };

describe("backtest fidelity", () => {
  it("does not carry a trade from warmup into out-of-sample results", () => {
    const result = runBacktest(candles(70), { ...base, qualityFilters: false, warmupCandles: 55 });
    expect(result.trades).toHaveLength(0);
    expect(result.metrics.totalFeesUsdt).toBe(0);
    expect(result.metrics.finalEquityUsdt).toBe(1000);
  });
  it("does not simulate a contrary-signal exit in the Demo profile", () => {
    const paper = runBacktest(candles(70), { ...base, qualityFilters: false, executionProfile: "paper" });
    const demo = runBacktest(candles(70), { ...base, qualityFilters: false, executionProfile: "demo-proxy" });
    expect(paper.trades[0]?.reason).toBe("SIGNAL_CONTRARY");
    expect(demo.trades).toHaveLength(0);
  });
  it("requires fixed parameters, complete candles and disjoint test windows", () => {
    const options = { trainCandles: 90, testCandles: 30, candidates: [{}], base: { ...base, executionProfile: "demo-proxy" as const } };
    expect(validateDemoStrategy(candles(180), options)).toMatchObject({ status: "simulation_only", result: { testedWindows: 3 } });
    expect(() => validateDemoStrategy(candles(180), { ...options, stepCandles: 10 })).toThrow("must not overlap");
    expect(() => validateDemoStrategy(candles(180), { ...options, candidates: [{}, {}] })).toThrow("one fixed candidate");
    const gap = candles(180); gap.splice(100, 1);
    expect(() => validateDemoStrategy(gap, options)).toThrow("contiguous");
  });
});
