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
    const candles = Array.from({ length: 60 }, (_, index) => ({
      ...candle(100 + index * 0.2, index),
      high: 100 + index * 0.2 + 0.3,
      low: 100 + index * 0.2 - 0.3,
      volume: index === 59 ? 2 : 1,
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
});
