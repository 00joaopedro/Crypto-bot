import { describe, expect, it } from "vitest";
import { evaluateStrategy } from "../src/strategy.js";
import type { Candle } from "../src/types.js";

const candle = (close: number, index: number): Candle => ({
  timestamp: index * 900_000,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
});

describe("strategy", () => {
  it("requires sufficient history", () => {
    expect(() => evaluateStrategy([candle(1, 0)])).toThrow(/50/);
  });

  it("holds when the score does not confirm a directional trend", () => {
    const candles = Array.from({ length: 60 }, (_, index) => candle(100, index));
    expect(evaluateStrategy(candles).action).toBe("HOLD");
  });

  it("exposes an explainable score and can enter an established trend", () => {
    const candles = Array.from({ length: 100 }, (_, index) => ({
      ...candle(100 + index * 0.2, index),
      high: 100 + index * 0.2 + 0.3,
      low: 100 + index * 0.2 - 0.3,
      volume: index === 99 ? 2 : 1,
    }));
    const signal = evaluateStrategy(candles, { minimumScore: 4 });
    expect(signal.scoreBreakdown).toEqual(expect.objectContaining({
      trend: expect.any(Number),
      rsi: expect.any(Number),
      volume: expect.any(Number),
      momentum: expect.any(Number),
      volatility: expect.any(Number),
      stopDistance: expect.any(Number),
    }));
    expect(signal.score).toBeGreaterThanOrEqual(0);
    expect(signal.scoreThreshold).toBe(4);
  });

  it("emits a conservative quantitative SELL on confirmed bearish momentum", () => {
    const candles = Array.from({ length: 100 }, (_, index) => ({
      ...candle(112 - index * 0.2, index),
      high: 112 - index * 0.2 + 0.3,
      low: 112 - index * 0.2 - 0.3,
      volume: index === 99 ? 2 : 1,
    }));
    expect(evaluateStrategy(candles, { minimumScore: 4, qualityFilters: false }).action).toBe("SELL");
    expect(evaluateStrategy(candles, { minimumScore: 4 }).action).toBe("HOLD");
  });
});

it("can reject a stretched buy with the experimental RSI ceiling without changing defaults", () => {
  const candles = Array.from({ length: 112 }, (_, index) => {
    const close = 100 + index * .09 + Math.sin(index * .73) * .55;
    return { ...candle(close, index), high: close + .15, low: close - .15 };
  });
  expect(evaluateStrategy(candles).action).toBe("BUY");
  expect(evaluateStrategy(candles, { maxBuyRsi: 63 }).action).toBe("HOLD");
});
