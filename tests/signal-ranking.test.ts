import { describe, expect, it } from "vitest";
import { rankSignals } from "../src/signal-ranking.js";
import type { Candle } from "../src/types.js";

const candlesFor = (base: number, slope: number): Candle[] =>
  Array.from({ length: 60 }, (_, index) => {
    const close = base + index * slope;
    return {
      timestamp: index * 900_000,
      open: close,
      high: close + 0.3,
      low: close - 0.3,
      close,
      volume: index === 59 ? 2 : 1,
    };
  });

describe("signal ranking", () => {
  it("ranks eligible BUY signals before HOLD signals", () => {
    const ranked = rankSignals([
      { symbol: "BTC/USDT", candles: candlesFor(100, 0.2) },
      { symbol: "ETH/USDT", candles: candlesFor(100, 0) },
    ], 4);

    expect(ranked[0]?.symbol).toBe("BTC/USDT");
    expect(ranked[0]?.eligible).toBe(true);
    expect(ranked[0]?.rank).toBe(1);
    expect(ranked[1]?.eligible).toBe(false);
  });

  it("uses score as the primary ordering among BUY signals", () => {
    const ranked = rankSignals([
      { symbol: "BTC/USDT", candles: candlesFor(100, 0.1) },
      { symbol: "SOL/USDT", candles: candlesFor(100, 0.3) },
    ], 1);

    expect(ranked[0]?.signal.score).toBeGreaterThanOrEqual(ranked[1]?.signal.score ?? 0);
  });
});
