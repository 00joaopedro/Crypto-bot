import { describe, expect, it } from "vitest";
import { calibrateAi } from "../src/ai-calibration.js";

describe("calibrateAi", () => {
  it("compares no AI with confidence thresholds", () => {
    const result = calibrateAi([
      { netPnlUsdt: 10, aiApprove: true, aiConfidence: 0.9 },
      { netPnlUsdt: -8, aiApprove: false, aiConfidence: 0.8 },
      { netPnlUsdt: 5, aiApprove: true, aiConfidence: 0.6 },
    ], [0.5, 0.8]);
    expect(result.noAi.netPnlUsdt).toBe(7);
    expect(result.thresholds[1]!.netPnlUsdt).toBe(10);
    expect(result.aiImprovesNetPnl).toBe(true);
  });
  it("rejects invalid confidence thresholds", () => {
    expect(() => calibrateAi([], [-0.1])).toThrow("between 0 and 1");
  });
  it("ignores non-finite P&L values", () => {
    const result = calibrateAi([
      { netPnlUsdt: Number.NaN, aiApprove: true, aiConfidence: 1 },
      { netPnlUsdt: Number.POSITIVE_INFINITY, aiApprove: true, aiConfidence: 1 },
      { netPnlUsdt: 3, aiApprove: true, aiConfidence: 0.9 },
    ]);
    expect(result.noAi.trades).toBe(1);
    expect(result.noAi.netPnlUsdt).toBe(3);
    expect(result.warnings).toContain("Oportunidades inválidas ignoradas: 2.");
  });
});
