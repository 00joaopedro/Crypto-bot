import { describe, expect, it, vi } from "vitest";
import { compareDemoStrategies, type ComparisonOptions } from "../src/strategy-comparison.js";
import { runBacktest } from "../src/backtest.js";
import { PaperTrader } from "../src/paper-trader.js";
import type { Candle } from "../src/types.js";
vi.mock("../src/strategy.js", () => ({ evaluateStrategy: () => ({ action: "BUY" }) }));
const candles = (n = 180): Candle[] => Array.from({ length: n }, (_, i) => ({ timestamp: i * 900000, open: 100, high: 104, low: 98, close: 103, volume: 1000 }));
const parameters = { stopLossRate: .01, takeProfitRate: .02, minimumSignalScore: 5, executionDelayCandles: 1 };
const standard = { name: "standard", feeRate: .001, slippageRate: .001, spreadRate: .002, assumedDepthUsdt: 1000, maxParticipationRate: .01 };
const options: ComparisonOptions = { symbol: "BTC/USDT", dataSource: "synthetic unit test; no market claim", trainCandles: 90, testCandles: 30, initialBalanceUsdt: 1000, tradeSizeUsdt: 100, constraints: { minimumNotionalUsdt: 5, minimumQuantity: .001, quantityStep: .001 }, baseline: parameters, alternatives: [{ name: "stricter", parameters: { ...parameters, minimumSignalScore: 6 } }], scenarios: [standard, { ...standard, name: "stress", feeRate: .002 }] };
const base = { initialBalanceUsdt: 1000, tradeSizeUsdt: 100, feeRate: .001, slippageRate: 0, stopLossRate: .01, takeProfitRate: .02, executionProfile: "demo-proxy" as const };
describe("fixed comparative validation", () => {
  it("compares the same disjoint OOS windows and discloses assumptions and input hash", () => {
    const before = JSON.stringify(options);
    const r = compareDemoStrategies(candles(), options);
    expect(r.dataset.sha256).toHaveLength(64);
    for (const s of r.results) {
      expect(s.variants.map(v => v.report.result.windows.map(w => [w.testStart, w.testEnd]))).toEqual([[[90,120],[120,150],[150,180]],[[90,120],[120,150],[150,180]]]);
      expect(s.variants[0]!.summary.closedTrades).toBeGreaterThan(0);
    }
    expect(r.results[1]!.variants[0]!.summary.meanWindowNetReturnPercent).toBeLessThan(r.results[0]!.variants[0]!.summary.meanWindowNetReturnPercent);
    expect(JSON.stringify(options)).toBe(before);
    expect(compareDemoStrategies(candles(), options)).toEqual(r);
  });
  it("rejects unsupported fields, duplicate variants, malformed candles and missing stress", () => {
    expect(() => compareDemoStrategies(candles(), { ...options, scenarios: [standard, standard] })).toThrow();
    expect(() => compareDemoStrategies(candles(), { ...options, alternatives: [{ name: "baseline", parameters }] })).toThrow();
    expect(() => compareDemoStrategies(candles(), { ...options, baseline: { ...parameters, stopLossRate: NaN } })).toThrow();
    expect(() => compareDemoStrategies(candles(), { ...options, scenarios: [standard, { ...standard, name: "same" }] })).toThrow("adverse");
    const gap = candles(); gap.splice(100,1);
    expect(() => compareDemoStrategies(gap, options)).toThrow("contiguous");
  });
  it("rejects orders below exchange minimums or above assumed depth without rounding up", () => {
    const r = compareDemoStrategies(candles(), { ...options, constraints: { ...options.constraints, minimumNotionalUsdt: 101 } });
    expect(r.results[0]!.variants[0]!.summary).toMatchObject({ closedTrades: 0, closedTradeExpectancyUsdt: null, evidence: "insufficient_sample" });
    expect(r.results[0]!.variants[0]!.summary.rejectedEntries).toBeGreaterThan(0);
    expect(compareDemoStrategies(candles(), { ...options, scenarios: [standard, { ...standard, name: "empty", assumedDepthUsdt: 0 }] }).results[1]!.variants[0]!.summary.closedTrades).toBe(0);
  });
  it("uses next OPEN and resolves a same-candle stop before target, net of both fees", () => {
    const r = runBacktest(candles(90), base);
    expect(r.trades[0]).toMatchObject({ entryTimestamp: 85 * 900000, exitTimestamp: 85 * 900000, entryPrice: 100, reason: "STOP_LOSS", exitPrice: 99 });
    expect(r.trades[0]!.netPnlUsdt).toBeCloseTo(-1.199);
  });
  it("uses previous volume instead of looking at the fill candle volume", () => {
    const data = candles(87); data[84]!.volume = 0;
    const r = runBacktest(data, { ...base, liquidity: { assumedDepthUsdt: 1000, maxParticipationRate: .01 } });
    expect(r.metrics.rejectedEntries).toBe(1);
    expect(r.trades[0]?.entryTimestamp).toBe(86 * 900000);
  });
  it("preserves the default operational close-price path and rounds offline quantity down", () => {
    const trader = new PaperTrader({ ...base, executionConstraints: { minimumNotionalUsdt: 1, minimumQuantity: .01, quantityStep: .1 } });
    const r = trader.processCandle(candles(1)[0]!, true);
    expect(r.events[0]).toMatchObject({ type: "OPENED", entryPrice: 103 });
    expect(trader.exportState().position!.quantity).toBeCloseTo(.9);
    expect(r.events).toHaveLength(1);
  });
});
