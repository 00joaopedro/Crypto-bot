import { describe, expect, it } from "vitest";
import { evaluateDemoPeriod } from "../src/demo-evaluation.js";

const candles = Array.from({ length: 30 }, (_, index) => ({ timestamp: index * 900_000, open: 100 + index, high: 101 + index, low: 99 + index, close: 100 + index, volume: 1000 }));

describe("evaluateDemoPeriod", () => {
  it("reports readiness and stability by symbol and regime", () => {
    const trades = Array.from({ length: 100 }, (_, index) => ({ symbol: index % 2 ? "BTC/USDT" : "ETH/USDT", entryTimestamp: 0, exitTimestamp: (20 + index % 10) * 900_000, netPnlUsdt: 1 }));
    const result = evaluateDemoPeriod(trades, candles);
    expect(result.sampleReady).toBe(true);
    expect(result.targetReached).toBe(false);
    expect(result.stableSymbols).toContain("BTC/USDT");
    expect(result.byRegime.length).toBeGreaterThan(0);
  });
  it("warns before the minimum sample", () => {
    const result = evaluateDemoPeriod([], candles);
    expect(result.sampleReady).toBe(false);
    expect(result.warnings[0]).toContain("Amostra insuficiente");
  });
});
