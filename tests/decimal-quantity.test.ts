import { describe, expect, it } from "vitest";
import { quantizeQuantityDown } from "../src/decimal-quantity.js";
import { PaperTrader } from "../src/paper-trader.js";

describe("decimal step flooring", () => {
  it("preserves exact multiples and their decimal notional", () => {
    expect(quantizeQuantityDown(30, 100, .1)).toEqual({ quantity: .3, notional: 30 });
    expect(quantizeQuantityDown(.07, .1, .1)).toEqual({ quantity: .7, notional: .07 });
    expect(quantizeQuantityDown(.00000003, 1, 1e-8)).toEqual({ quantity: 3e-8, notional: 3e-8 });
    expect(quantizeQuantityDown(3e21, 1e21, 1)).toEqual({ quantity: 3, notional: 3e21 });
  });
  it("never promotes genuinely insufficient budgets across a boundary", () => {
    expect(quantizeQuantityDown(29.999999999999996, 100, .1)).toEqual({ quantity: .2, notional: 20 });
    expect(quantizeQuantityDown(29, 100, .1)).toEqual({ quantity: .2, notional: 20 });
    expect(quantizeQuantityDown(9, 100, .1)).toEqual({ quantity: 0, notional: 0 });
  });
  it.each([30, 29.999999999999996])("checks minimums correctly for a %s USDT entry", (budget) => {
    const trader = new PaperTrader({ initialBalanceUsdt: 100, tradeSizeUsdt: budget, feeRate: .001, slippageRate: 0, stopLossRate: .01, takeProfitRate: .02, executionConstraints: { minimumNotionalUsdt: 30, minimumQuantity: .3, quantityStep: .1 } });
    const r = trader.processCandle({ timestamp: 1, open: 100, high: 100, low: 100, close: 100, volume: 1 }, true);
    if (budget === 30) {
      expect(r.events[0]).toMatchObject({ type: "OPENED", quantity: .3, notionalUsdt: 30 });
    } else {
      expect(r.events).toHaveLength(0);
      expect(trader.hasOpenPosition).toBe(false);
    }
  });
});
