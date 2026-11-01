import { describe, expect, it } from "vitest";
import { reconcileDemoExecutions, type ConfirmedDemoOrder } from "../src/demo-reconciliation.js";
import type { DemoFill } from "../src/demo-ledger.js";

const orders: ConfirmedDemoOrder[] = [
  { id: "buy", symbol: "BTC/USDT", side: "buy", filled: 1, terminal: true, ownershipConfirmed: true },
  { id: "stop", symbol: "BTC/USDT", side: "sell", filled: 0.5, terminal: true, ownershipConfirmed: true },
];
const fills: DemoFill[] = [
  { id: "1", orderId: "buy", symbol: "BTC/USDT", side: "buy", timestamp: 1, amount: 1, costUsdt: 100, fees: [{ currency: "USDT", cost: 1 }] },
  { id: "2", orderId: "stop", symbol: "BTC/USDT", side: "sell", timestamp: 2, amount: 0.5, costUsdt: 60, fees: [{ currency: "USDT", cost: 0.6 }] },
];
describe("Demo execution reconciliation", () => {
  it("calculates a partial protective exit only with complete matching evidence", () => {
    const result = reconcileDemoExecutions({ historyComplete: true, orders, fills });
    expect(result.status).toBe("confirmed");
    if (result.status === "confirmed") expect(result.realizedPnlUsdt).toBeCloseTo(8.9);
  });
  it("refuses incomplete history, ownership and open orders", () => {
    expect(reconcileDemoExecutions({ historyComplete: false, orders, fills }).status).toBe("unavailable");
    expect(reconcileDemoExecutions({ historyComplete: true, orders: [orders[0]!, { ...orders[1]!, ownershipConfirmed: false }], fills }).status).toBe("unavailable");
    expect(reconcileDemoExecutions({ historyComplete: true, orders: [orders[0]!, { ...orders[1]!, terminal: false }], fills }).status).toBe("unavailable");
  });
  it("refuses unknown or inconsistent fills and missing executions", () => {
    expect(reconcileDemoExecutions({ historyComplete: true, orders, fills: [fills[0]!] })).toMatchObject({ reason: "order_fill_total_mismatch" });
    expect(reconcileDemoExecutions({ historyComplete: true, orders, fills: [fills[0]!, { ...fills[1]!, orderId: "external" }] })).toMatchObject({ reason: "fill_order_mismatch" });
    expect(reconcileDemoExecutions({ historyComplete: true, orders, fills: [fills[0]!, { ...fills[1]!, side: "buy" }] })).toMatchObject({ reason: "fill_order_mismatch" });
  });
  it("does not treat a tiny filled order with no executions as reconciled", () => {
    const tiny = { ...orders[0]!, filled: 1e-12 };
    expect(reconcileDemoExecutions({ historyComplete: true, orders: [tiny], fills: [] })).toMatchObject({ reason: "order_fill_total_mismatch" });
  });
});
