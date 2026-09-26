import { describe, expect, it } from "vitest";
import { buildStatisticalReport } from "../src/analytics.js";

describe("continuous statistics", () => {
  it("calculates aggregate metrics and dimensions", () => {
    const report = buildStatisticalReport([
      { symbol: "BTC/USDT", netPnlUsdt: 4, exitTimestamp: Date.UTC(2026, 0, 1, 10), regime: "trend", aiState: "AI_AVAILABLE" },
      { symbol: "BTC/USDT", netPnlUsdt: -2, exitTimestamp: Date.UTC(2026, 0, 1, 11), regime: "lateral", aiState: "AI_UNAVAILABLE" },
    ]);
    expect(report.netPnlUsdt).toBe(2);
    expect(report.profitFactor).toBe(2);
    expect(report.expectancyUsdt).toBe(1);
    expect(report.maxDrawdownUsdt).toBe(2);
    expect(report.bySymbol["BTC/USDT"]?.trades).toBe(2);
    expect(report.byHour["10"]?.wins).toBe(1);
    expect(report.byAiState.AI_UNAVAILABLE?.losses).toBe(1);
  });
});
