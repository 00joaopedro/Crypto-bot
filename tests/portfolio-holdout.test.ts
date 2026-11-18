import { expect, it, vi } from "vitest";
import { comparePortfolioHoldout, runPortfolioScenario } from "../src/portfolio-comparison.js";
import type { ComparisonOptions } from "../src/strategy-comparison.js";
import type { Candle } from "../src/types.js";

vi.mock("../src/strategy.js", () => ({
  evaluateStrategy: (bars: Candle[], options: { minimumScore: number }) => ({
    action: options.minimumScore === 5 && bars.length % 30 === 0 ? "BUY" : "HOLD", score: 5,
  }),
}));

const limits = { maxConcurrentPositions: 2, maxExposureRate: 1, maxAltExposureRate: 1 };
const constraints = { minimumNotionalUsdt: 0, minimumQuantity: 0.001, quantityStep: 0.001 };
const baseline = { minimumSignalScore: 5, executionDelayCandles: 1, stopLossRate: 0.01, takeProfitRate: 0.02 };
const standard = { name: "standard", feeRate: 0.001, slippageRate: 0, spreadRate: 0, assumedDepthUsdt: 1000, maxParticipationRate: 1 };
const candle = (index: number, high = 100, low = 100): Candle => ({
  timestamp: index * 900_000, open: 100, high, low, close: 100, volume: 1000,
});

function study(losingHoldout: boolean) {
  const warmup = 96;
  return ["BTC/USDT", "ETH/USDT"].map(symbol => {
    const options: ComparisonOptions = {
      symbol, dataSource: "synthetic", constraints, trainCandles: warmup, testCandles: 960,
      initialBalanceUsdt: 100, tradeSizeUsdt: 10, baseline,
      alternatives: [{ name: "stricter", parameters: { ...baseline, minimumSignalScore: 6 } }],
      scenarios: [standard, { ...standard, name: "stress", feeRate: 0.002 }],
    };
    return {
      options, candles: Array.from({ length: warmup + 2880 }, (_, i) =>
        losingHoldout && i >= warmup + 960 ? candle(i, 100, 98) : candle(i, 105)),
    };
  });
}

it("freezes the training winner across scenarios and both holdout blocks even when unseen data reverses the result", () => {
  const rising = comparePortfolioHoldout(study(false), limits);
  const adverse = comparePortfolioHoldout(study(true), limits);
  expect(adverse.calibration).toEqual(rising.calibration);
  expect(adverse.selected).toEqual({ name: "baseline", parameters: baseline });
  expect(adverse.selected).toEqual(rising.selected);
  expect(rising.results.every(r => r.bothBlocksPositive)).toBe(true);
  expect(adverse.results.every(r => !r.bothBlocksPositive && r.result.closedTrades > 0)).toBe(true);
  expect(adverse.results[0]?.result.blocks).toHaveLength(2);
  const [first, second] = adverse.results[0]!.result.blocks!;
  expect(first!.endExclusiveUtc).toBe(second!.startUtc);
  expect(first!.endingEquityUsdt).toBe(second!.startingEquityUsdt);
});

it("carries a position across the split and counts its realized P&L only at exit", () => {
  const candles = [candle(0), candle(1), candle(2), candle(3, 103)];
  const result = runPortfolioScenario([{ symbol: "BTC/USDT", constraints, candles }],
    new Map([["BTC/USDT", [, 5]]]), 1, baseline, standard, limits, 100, 10, undefined, 3);
  const [first, second] = result.blocks!;
  expect(first).toMatchObject({ closedTrades: 0, realizedPnlUsdt: 0, winRatePercent: null });
  expect(second).toMatchObject({ closedTrades: 1, winRatePercent: 100 });
  expect(second!.realizedPnlUsdt).toBeCloseTo(result.realizedPnlUsdt);
  expect(first!.netReturnUsdt + second!.netReturnUsdt).toBeCloseTo(result.netReturnUsdt);
});

it("rejects missing candles instead of compressing the historical periods", () => {
  const inputs = study(false);
  for (const input of inputs) input.candles[200]!.timestamp += 900_000;
  expect(() => comparePortfolioHoldout(inputs, limits)).toThrow("ordered and contiguous");
});
