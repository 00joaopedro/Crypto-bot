import { describe, expect, it } from "vitest";
import { compareDemoBaseline } from "../src/demo-baseline.js";

describe("Demo baseline comparison", () => {
  it("does not claim coverage even when all balances match", () => {
    expect(compareDemoBaseline({ BTC: 1, USDT: 5000 }, { BTC: 1, USDT: 5000 })).toEqual({ status: "unavailable", reason: "baseline_history_coverage_unconfirmed" });
  });
  it("detects unexplained changes, including new assets", () => {
    expect(compareDemoBaseline({ BTC: 1, USDT: 5000 }, { BTC: 1, USDT: 4999 })).toMatchObject({ reason: "baseline_balance_changed" });
    expect(compareDemoBaseline({ USDT: 5000 }, { USDT: 5000, ETH: 1 })).toMatchObject({ reason: "baseline_balance_changed" });
    expect(compareDemoBaseline({ BTC: 1 }, { BTC: 1 })).toMatchObject({ reason: "baseline_usdt_missing" });
  });
});
