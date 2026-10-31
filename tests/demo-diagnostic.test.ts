import { describe, expect, it, vi } from "vitest";
import { inspectDemoAccounting } from "../src/demo-diagnostic.js";

const row = { client_order_id: "CB1", symbol: "BTC/USDT", status: "PLACED", result: { orderId: "1" }, attached_algo_client_id: "AP1", created_at: new Date(Date.now() - 120_000) };
describe("Demo accounting diagnostic", () => {
  it("does not query the exchange for an incomplete journal", async () => {
    const executor = { collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn() };
    const persistence = { demoOrderJournal: async () => [{ ...row, attached_algo_client_id: null }] };
    expect(await inspectDemoAccounting(persistence, executor)).toMatchObject({ reason: "journal_identity_incomplete" });
    expect(executor.collectOrderEvidence).not.toHaveBeenCalled();
  });
  it("collects evidence without claiming complete accounting", async () => {
    const executor = {
      collectOrderEvidence: vi.fn(async () => ({ status: "collected" as const, buys: [{ id: "1", clientOrderId: "CB1", symbol: "BTC/USDT", side: "buy" as const, attachedAlgoClientIds: ["AP1"] }], sells: [], protections: [{ algoClientId: "AP1", symbol: "BTC/USDT", side: "sell" as const, spawnedOrderIds: [] }], orders: [], protectionStates: {} })),
      collectFillHistory: vi.fn(async () => ({ status: "collected" as const, fills: [], from: 0, to: 1 })),
    };
    expect(await inspectDemoAccounting({ demoOrderJournal: async () => [row] }, executor)).toMatchObject({ status: "unavailable", reason: "coverage_and_positions_unconfirmed", checkedOrders: 0, checkedFills: 0 });
    expect(executor.collectFillHistory).toHaveBeenCalledOnce();
  });
});
