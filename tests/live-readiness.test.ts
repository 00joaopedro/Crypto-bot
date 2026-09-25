import { describe, expect, it } from "vitest";
import { evaluateRealCapitalReadiness } from "../src/live-readiness.js";

const goodEvidence = { operations: 220, netReturnPercent: 8, profitFactor: 1.35, maxDrawdownPercent: 3, profitableWindows: 3, totalWindows: 4 };

describe("evaluateRealCapitalReadiness", () => {
  it("approves only conservative, consistent evidence", () => {
    const result = evaluateRealCapitalReadiness(goodEvidence, { killSwitchEnabled: true, liveTradingEnabled: false });
    expect(result.eligible).toBe(true);
    expect(result.limits.maximumExposurePercent).toBe(1);
  });

  it("rejects insufficient evidence and any live flag", () => {
    const result = evaluateRealCapitalReadiness({ ...goodEvidence, operations: 100, netReturnPercent: -1 }, { killSwitchEnabled: false, liveTradingEnabled: true });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining("Amostra"),
      expect.stringContaining("retorno"),
      expect.stringContaining("Kill switch"),
      expect.stringContaining("Trading real"),
    ]));
  });

  it("enforces the minimum sample and conservative risk envelope", () => {
    expect(() => evaluateRealCapitalReadiness(goodEvidence, { minimumOperations: 99, killSwitchEnabled: true, liveTradingEnabled: false })).toThrow("at least 100");
    expect(() => evaluateRealCapitalReadiness(goodEvidence, { maximumRiskPerTradePercent: 2, killSwitchEnabled: true, liveTradingEnabled: false })).toThrow("must not exceed");
  });
});
