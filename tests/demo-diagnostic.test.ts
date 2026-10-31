import { describe, expect, it, vi } from "vitest";
import { inspectDemoAccounting } from "../src/demo-diagnostic.js";

const row = { client_order_id: "CB1", symbol: "BTC/USDT", status: "PLACED", result: { orderId: "1" }, attached_algo_client_id: "AP1", created_at: new Date(Date.now() - 120_000) };
const getDemoBaselineCandidate = async () => ({ observedAt: new Date(1), balances: { USDT: 0 }, evidence: {}, status: "UNVERIFIED" });
describe("Demo accounting diagnostic", () => {
  it("excludes legacy failures from the new period but still blocks old pending orders", async () => {
    const baseline = { observedAt: new Date(Date.now() - 10_000), balances: { USDT: 5000 }, evidence: {}, status: "UNVERIFIED" };
    const executor = { collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn() };
    const failed = { ...row, status: "FAILED" };
    const persistence = { demoOrderJournal: async () => [failed], getDemoBaselineCandidate: async () => baseline };
    expect(await inspectDemoAccounting(persistence, executor)).toMatchObject({ reason: "no_confirmed_orders", journalCounts: { failed: 0, total: 0 } });
    expect(await inspectDemoAccounting({ ...persistence, demoOrderJournal: async () => [{ ...failed, status: "PENDING" }] }, executor)).toMatchObject({ reason: "pending_order" });
  });
  it("summarizes failed and skipped journal entries without exposing errors or asserting exchange rejection", async () => {
    const executor = { collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn() };
    const failed = { ...row, status: "FAILED", result: { error: "private error detail" } };
    const skipped = { ...row, status: "SKIPPED" };
    const result = await inspectDemoAccounting({ demoOrderJournal: async () => [failed, skipped], getDemoBaselineCandidate }, executor);
    expect(result).toEqual({ status: "unavailable", reason: "no_confirmed_orders", journalCounts: { failed: 1, skipped: 1, total: 2 } });
    expect(JSON.stringify(result)).not.toContain("private error detail");
    expect(executor.collectOrderEvidence).not.toHaveBeenCalled();
  });
  it("does not query the exchange for an incomplete journal", async () => {
    const executor = { collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn() };
    const persistence = { demoOrderJournal: async () => [{ ...row, attached_algo_client_id: null }], getDemoBaselineCandidate };
    expect(await inspectDemoAccounting(persistence, executor)).toMatchObject({ reason: "journal_identity_incomplete" });
    expect(executor.collectOrderEvidence).not.toHaveBeenCalled();
  });
  it("collects evidence without claiming complete accounting", async () => {
    const executor = {
      collectOrderEvidence: vi.fn(async () => ({ status: "collected" as const, buys: [{ id: "1", clientOrderId: "CB1", symbol: "BTC/USDT", side: "buy" as const, attachedAlgoClientIds: ["AP1"] }], sells: [], protections: [{ algoClientId: "AP1", symbol: "BTC/USDT", side: "sell" as const, spawnedOrderIds: [] }], orders: [{ id: "1", symbol: "BTC/USDT", side: "buy" as const, filled: 0, terminal: true, ownershipConfirmed: false }], protectionStates: {} })),
      collectFillHistory: vi.fn(async () => ({ status: "collected" as const, fills: [], from: 0, to: 1 })),
    };
    expect(await inspectDemoAccounting({ demoOrderJournal: async () => [row], getDemoBaselineCandidate }, executor)).toMatchObject({ status: "unavailable", reason: "coverage_and_positions_unconfirmed", checkedOrders: 1, checkedFills: 0 });
    expect(executor.collectFillHistory).toHaveBeenCalledOnce();
  });
  it("reports missing exchange fills instead of accepting an order as reconciled", async () => {
    const executor = {
      collectOrderEvidence: vi.fn(async () => ({ status: "collected" as const, buys: [{ id: "1", clientOrderId: "CB1", symbol: "BTC/USDT", side: "buy" as const, attachedAlgoClientIds: ["AP1"] }], sells: [], protections: [{ algoClientId: "AP1", symbol: "BTC/USDT", side: "sell" as const, spawnedOrderIds: [] }], orders: [{ id: "1", symbol: "BTC/USDT", side: "buy" as const, filled: 1, terminal: true, ownershipConfirmed: false }], protectionStates: {} })),
      collectFillHistory: vi.fn(async () => ({ status: "collected" as const, fills: [], from: 0, to: 1 })),
    };
    expect(await inspectDemoAccounting({ demoOrderJournal: async () => [row], getDemoBaselineCandidate }, executor)).toMatchObject({ status: "unavailable", reason: "order_fill_total_mismatch" });
  });
});

