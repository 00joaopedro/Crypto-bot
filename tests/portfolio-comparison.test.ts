import { describe, expect, it } from "vitest";
import { comparePortfolio, runPortfolioScenario } from "../src/portfolio-comparison.js";
import { comparisonSchema } from "../src/strategy-comparison.js";
import type { Candle } from "../src/types.js";

const candle = (index: number, low = 100): Candle => ({
  timestamp: index * 900_000, open: 100, high: 100, low, close: 100, volume: 1000,
});
const constraints = { minimumNotionalUsdt: 0, minimumQuantity: 0.01, quantityStep: 0.01 };
const parameters = { stopLossRate: 0.01, takeProfitRate: 0.02, minimumSignalScore: 5, executionDelayCandles: 1 };
const scenario = { name: "base", feeRate: 0.001, slippageRate: 0, spreadRate: 0, assumedDepthUsdt: 1000, maxParticipationRate: 1 };
const limits = { maxConcurrentPositions: 2, maxExposureRate: 1, maxAltExposureRate: 1 };
const setup = (lastLow = 100) => [
  { symbol: "BTC/USDT", constraints, candles: [candle(0), candle(1), candle(2, lastLow), candle(3)] },
  { symbol: "ETH/USDT", constraints, candles: [candle(0), candle(1), candle(2), candle(3)] },
];

describe("portfolio comparison", () => {
  it("ranks one entry when the shared wallet cannot pay for both", () => {
    const result = runPortfolioScenario(setup(), new Map([["BTC/USDT", [, 5]], ["ETH/USDT", [, 7]]]),
      1, parameters, scenario, limits, 15, 10);
    expect(result.perSymbol[0]?.rejected).toEqual({ cash: 1 });
    expect(result.perSymbol[1]?.openPosition).toMatchObject({ entryTimestamp: 1_800_000, entryNotional: 10 });
    expect(result.cashUsdt).toBeCloseTo(4.99);
    expect(result.finalEquityUsdt).toBeCloseTo(14.98);
  });

  it("keeps intrabar exit proceeds and positions unavailable for other entries at that open", () => {
    const result = runPortfolioScenario(setup(98), new Map([["BTC/USDT", [, 8]], ["ETH/USDT", [, 7, 7]]]),
      1, parameters, scenario, { ...limits, maxConcurrentPositions: 1 }, 100, 10);
    expect(result.closedTrades).toBe(1);
    expect(result.peakConcurrentPositions).toBe(1);
    expect(result.perSymbol[1]?.rejected).toEqual({ positions: 1 });
    expect(result.perSymbol[1]?.openPosition?.entryTimestamp).toBe(2_700_000);
    expect(result.realizedPnlUsdt).toBeCloseTo(-0.1199);
  });

  it("reserves pre-existing exposure and applies the altcoin and total limits independently", () => {
    const scores = new Map([["BTC/USDT", [, 5]], ["ETH/USDT", [, 7]]]);
    const alt = runPortfolioScenario(setup(), scores, 1, parameters, scenario, { ...limits, maxAltExposureRate: 0.09 }, 100, 10);
    expect(alt.perSymbol[1]?.rejected).toEqual({ altExposure: 1 });
    expect(alt.peakAltExposureRate).toBe(0);
    const total = runPortfolioScenario(setup(), scores, 1, parameters, scenario, { ...limits, maxExposureRate: 0.15 }, 100, 10);
    expect(total.perSymbol[0]?.rejected).toEqual({ totalExposure: 1 });
    expect(total.peakExposureRate).toBeCloseTo(0.1);
  });

  it("does not release the slot at the open for a position that closes later that candle", () => {
    const instruments = setup();
    instruments[0]!.candles[3] = candle(3, 98);
    const result = runPortfolioScenario(instruments, new Map([["BTC/USDT", [, 8]], ["ETH/USDT", [, , 7]]]),
      1, parameters, scenario, { ...limits, maxConcurrentPositions: 1 }, 100, 10);
    expect(result.closedTrades).toBe(1);
    expect(result.openPositions).toBe(0);
    expect(result.perSymbol[1]?.rejected).toEqual({ positions: 1 });
    expect(result.finalEquityUsdt).toBeCloseTo(99.8801);
    expect(result.maxDrawdownUsdt).toBeCloseTo(0.1199);
    expect(result.recoveryFactor).toBeCloseTo(-1);
    expect(result.top3TradesProfitSharePercent).toBeNull();
  });

  it("rejects mismatched market timelines before comparing", () => {
    const datasets = setup().map(({ symbol, candles }) => ({
      candles,
      options: comparisonSchema.parse({
        symbol, dataSource: "fixture", trainCandles: 95, testCandles: 5, initialBalanceUsdt: 100,
        tradeSizeUsdt: 10, constraints, baseline: parameters, alternatives: [{ name: "alt", parameters }],
        scenarios: [scenario, { ...scenario, name: "stress", feeRate: 0.002 }],
      }),
    }));
    datasets[0]!.candles[0] = candle(1);
    expect(() => comparePortfolio(datasets, limits)).toThrow("aligned series");
  });
});
