import { describe, expect, it } from "vitest";
import { calculateDemoLedger, type DemoFill } from "../src/demo-ledger.js";

const buy: DemoFill = { id: "1", orderId: "buy1", symbol: "BTC/USDT", side: "buy", timestamp: 1, amount: 1, costUsdt: 100, fees: [{ currency: "USDT", cost: 1 }] };
const sell: DemoFill = { id: "2", orderId: "sell1", symbol: "BTC/USDT", side: "sell", timestamp: 2, amount: 0.5, costUsdt: 60, fees: [{ currency: "USDT", cost: 0.6 }] };

describe("Demo ledger", () => {
  it("accounts for partial sales, cost basis and confirmed fees", () => {
    const result = calculateDemoLedger([sell, buy], true);
    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") return;
    expect(result.realizedPnlUsdt).toBeCloseTo(8.9);
    expect(result.positions["BTC/USDT"]?.quantity).toBeCloseTo(0.5);
    expect(result.positions["BTC/USDT"]?.costUsdt).toBeCloseTo(50.5);
  });
  it("does not produce a result without complete history, fees or a matching buy", () => {
    expect(calculateDemoLedger([buy, sell], false)).toMatchObject({ status: "unavailable" });
    expect(calculateDemoLedger([{ ...buy, fees: [] }], true)).toMatchObject({ status: "unavailable" });
    expect(calculateDemoLedger([sell], true)).toMatchObject({ status: "unavailable", reason: "unmatched_sell_or_missing_history" });
    expect(calculateDemoLedger([buy, { ...sell, fees: [{ currency: "OKB", cost: 0.1 }] }], true)).toMatchObject({ status: "unavailable", reason: "unsupported_fee_currency" });
    expect(calculateDemoLedger([buy, buy], true)).toMatchObject({ status: "unavailable" });
  });
  it("uses base-currency fees when computing holdings", () => {
    const result = calculateDemoLedger([{ ...buy, fees: [{ currency: "BTC", cost: 0.01 }] }], true);
    expect(result.status).toBe("confirmed");
    if (result.status === "confirmed") expect(result.positions["BTC/USDT"]?.quantity).toBeCloseTo(0.99);
  });
  it("rejects tiny unmatched sales and preserves small remaining positions", () => {
    const tinySell = { ...sell, amount: 1e-12 };
    expect(calculateDemoLedger([tinySell], true)).toMatchObject({ reason: "unmatched_sell_or_missing_history" });
    const tinyBuy = { ...buy, amount: 2e-12 };
    const result = calculateDemoLedger([tinyBuy, tinySell], true);
    expect(result.status).toBe("confirmed");
    if (result.status === "confirmed") expect(result.positions["BTC/USDT"]?.quantity).toBeCloseTo(1e-12, 18);
  });
  it("rejects overflow in fee aggregation and inventory cost", () => {
    expect(calculateDemoLedger([{ ...buy, fees: [{ currency: "USDT", cost: 1e308 }, { currency: "USDT", cost: 1e308 }] }], true)).toMatchObject({ status: "unavailable" });
  });
});
