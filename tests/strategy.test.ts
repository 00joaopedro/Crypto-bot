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

  it("holds when there is no fresh crossover", () => {
    const candles = Array.from({ length: 60 }, (_, index) => candle(100 + index, index));
    expect(evaluateStrategy(candles).action).toBe("HOLD");
  });
});
