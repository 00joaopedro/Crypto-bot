import { describe, expect, it } from "vitest";
import { accountForDemoEvidence, type ExecutedDemoOrder } from "../src/demo-accounting-evidence.js";
import type { DemoFill } from "../src/demo-ledger.js";

const buy: ExecutedDemoOrder = { id: "b", clientOrderId: "client", symbol: "BTC/USDT", side: "buy", attachedAlgoClientIds: ["algo"], filled: 1, terminal: true };
const sell: ExecutedDemoOrder = { id: "s", clientOrderId: null, symbol: "BTC/USDT", side: "sell", filled: 0.5, terminal: true };
const fills: DemoFill[] = [
  { id: "f1", orderId: "b", symbol: "BTC/USDT", side: "buy", timestamp: 1, amount: 1, costUsdt: 100, fees: [{ currency: "USDT", cost: 1 }] },
  { id: "f2", orderId: "s", symbol: "BTC/USDT", side: "sell", timestamp: 2, amount: 0.5, costUsdt: 60, fees: [{ currency: "USDT", cost: 0.6 }] },
];
const evidence = { journalComplete: true, historyComplete: true, positionsReconciled: true, coverageStart: 0, coverageEnd: 3, journal: [{ orderId: "b", clientOrderId: "client", symbol: "BTC/USDT", attachedAlgoClientId: "algo" }], buys: [buy], protections: [{ algoClientId: "algo", symbol: "BTC/USDT", side: "sell" as const, spawnedOrderIds: ["s"] }], sells: [sell], fills };
describe("accounting from Demo evidence", () => {
  it("connects verified ownership to fill accounting", () => {
    const result = accountForDemoEvidence(evidence);
    expect(result.status).toBe("confirmed");
    if (result.status === "confirmed") expect(result.realizedPnlUsdt).toBeCloseTo(8.9);
  });
  it("requires all coverage proofs and a real baseline", () => {
    for (const field of ["journalComplete", "historyComplete", "positionsReconciled"] as const) expect(accountForDemoEvidence({ ...evidence, [field]: false })).toMatchObject({ reason: "evidence_coverage_incomplete" });
    expect(accountForDemoEvidence({ ...evidence, journal: [], buys: [], sells: [], fills: [] })).toMatchObject({ reason: "baseline_unconfirmed" });
    expect(accountForDemoEvidence({ ...evidence, coverageEnd: 1 })).toMatchObject({ reason: "fill_outside_coverage" });
  });
  it("rejects unowned orders, missing executions and unknown fees", () => {
    expect(accountForDemoEvidence({ ...evidence, protections: [] }).status).toBe("unavailable");
    expect(accountForDemoEvidence({ ...evidence, buys: [buy, { ...buy, id: "other" }] })).toMatchObject({ reason: "unattributed_buy" });
    expect(accountForDemoEvidence({ ...evidence, fills: [fills[0]!] })).toMatchObject({ reason: "order_fill_total_mismatch" });
    expect(accountForDemoEvidence({ ...evidence, fills: [fills[0]!, { ...fills[1]!, fees: [] }] }).status).toBe("unavailable");
    expect(accountForDemoEvidence({ ...evidence, sells: [{ ...sell, terminal: false }] }).status).toBe("unavailable");
  });
});
