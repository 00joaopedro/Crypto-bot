import { describe, expect, it, vi } from "vitest";
import { inspectDemoAccounting } from "../src/demo-diagnostic.js";

const row = { client_order_id: "CB1", symbol: "BTC/USDT", status: "PLACED", result: { orderId: "1" }, attached_algo_client_id: "AP1", created_at: new Date(Date.now() - 120_000) };
const getDemoBaselineCandidate = async () => ({ observedAt: new Date(Date.now() - 180_000), balances: { USDT: 0 }, evidence: { accountIdentity: { uid: "123", mainUid: "123" } }, status: "UNVERIFIED" });
describe("Demo accounting diagnostic", () => {
  it("rejects a changed account or a legacy baseline with no identity before exchange history calls", async () => {
    const executor = { inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "456", mainUid: "456" } }), collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn(), collectAccountCoverage: vi.fn(async () => ({ status: "covered" as const, billCount: 0 })) };
    expect(await inspectDemoAccounting({ demoOrderJournal: async () => [row], getDemoBaselineCandidate }, executor)).toMatchObject({ reason: "account_identity_mismatch_or_missing" });
    expect(await inspectDemoAccounting({ demoOrderJournal: async () => [row], getDemoBaselineCandidate: async () => ({ ...(await getDemoBaselineCandidate()), evidence: {} }) }, executor)).toMatchObject({ reason: "account_identity_mismatch_or_missing" });
    expect(executor.collectOrderEvidence).not.toHaveBeenCalled();
  });
  it("excludes legacy failures from the new period but still blocks old pending orders", async () => {
    const baseline = { observedAt: new Date(Date.now() - 10_000), balances: { USDT: 5000 }, evidence: { accountIdentity: { uid: "123", mainUid: "123" } }, status: "UNVERIFIED" };
    const executor = { collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn(), collectAccountCoverage: vi.fn(async () => ({ status: "covered" as const, billCount: 0 })), inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "123", mainUid: "123" } }) };
    const failed = { ...row, status: "FAILED" };
    const persistence = { demoOrderJournal: async () => [failed], getDemoBaselineCandidate: async () => baseline };
    expect(await inspectDemoAccounting(persistence, executor)).toMatchObject({ reason: "no_confirmed_orders", journalCounts: { failed: 0, total: 0 } });
    expect(await inspectDemoAccounting({ ...persistence, demoOrderJournal: async () => [{ ...failed, status: "PENDING" }] }, executor)).toMatchObject({ reason: "pending_order" });
  });
  it("summarizes failed and skipped journal entries without exposing errors or asserting exchange rejection", async () => {
    const executor = { collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn(), collectAccountCoverage: vi.fn(async () => ({ status: "covered" as const, billCount: 0 })), inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "123", mainUid: "123" } }) };
    const failed = { ...row, status: "FAILED", result: { error: "private error detail" } };
    const skipped = { ...row, status: "SKIPPED" };
    const result = await inspectDemoAccounting({ demoOrderJournal: async () => [failed, skipped], getDemoBaselineCandidate }, executor);
    expect(result).toEqual({ status: "unavailable", reason: "no_confirmed_orders", journalCounts: { failed: 1, skipped: 1, total: 2 } });
    expect(JSON.stringify(result)).not.toContain("private error detail");
    expect(executor.collectOrderEvidence).not.toHaveBeenCalled();
  });
  it("does not query the exchange for an incomplete journal", async () => {
    const executor = { collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn(), collectAccountCoverage: vi.fn(async () => ({ status: "covered" as const, billCount: 0 })), inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "123", mainUid: "123" } }) };
    const persistence = { demoOrderJournal: async () => [{ ...row, attached_algo_client_id: null }], getDemoBaselineCandidate };
    expect(await inspectDemoAccounting(persistence, executor)).toMatchObject({ reason: "journal_identity_incomplete" });
    expect(executor.collectOrderEvidence).not.toHaveBeenCalled();
  });
  it("does not ignore an uncertain failure when another order was placed", async () => {
    const executor = { collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn(), collectAccountCoverage: vi.fn(async () => ({ status: "covered" as const, billCount: 0 })), inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "123", mainUid: "123" } }) };
    const persistence = { demoOrderJournal: async () => [row, { ...row, status: "FAILED" }], getDemoBaselineCandidate };
    expect(await inspectDemoAccounting(persistence, executor)).toMatchObject({ reason: "failed_order_unconfirmed" });
    expect(executor.collectOrderEvidence).not.toHaveBeenCalled();
  });
  it("refuses invalid journal dates and future baselines", async () => {
    const executor = { collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn(), collectAccountCoverage: vi.fn(async () => ({ status: "covered" as const, billCount: 0 })), inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "123", mainUid: "123" } }) };
    expect(await inspectDemoAccounting({ demoOrderJournal: async () => [{ ...row, created_at: new Date(NaN) }], getDemoBaselineCandidate }, executor)).toMatchObject({ reason: "invalid_journal_date" });
    expect(await inspectDemoAccounting({ demoOrderJournal: async () => [row], getDemoBaselineCandidate: async () => ({ ...(await getDemoBaselineCandidate()), observedAt: new Date(Date.now() + 60_000) }) }, executor)).toMatchObject({ reason: "baseline_missing" });
  });
  it("collects evidence without claiming complete accounting", async () => {
    const executor = {
      collectOrderEvidence: vi.fn(async () => ({ status: "collected" as const, buys: [{ id: "1", clientOrderId: "CB1", symbol: "BTC/USDT", side: "buy" as const, attachedAlgoClientIds: ["AP1"] }], sells: [], protections: [{ algoClientId: "AP1", symbol: "BTC/USDT", side: "sell" as const, spawnedOrderIds: [] }], orders: [{ id: "1", symbol: "BTC/USDT", side: "buy" as const, filled: 0, terminal: true, ownershipConfirmed: false }], protectionStates: {} })),
      collectFillHistory: vi.fn(async () => ({ status: "collected" as const, fills: [], from: 0, to: 1 })),
      inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "123", mainUid: "123" } }),
      collectAccountCoverage: vi.fn(async () => ({ status: "covered" as const, billCount: 0 })),
    };
    const baseline = await getDemoBaselineCandidate();
    expect(await inspectDemoAccounting({ demoOrderJournal: async () => [row], getDemoBaselineCandidate: async () => baseline }, executor)).toMatchObject({ status: "unavailable", reason: "positions_and_snapshot_unconfirmed", checkedOrders: 1, checkedFills: 0 });
    expect(executor.collectFillHistory).toHaveBeenCalledOnce();
    expect(executor.collectFillHistory).toHaveBeenCalledWith(expect.objectContaining({ from: baseline.observedAt.getTime() }));
  });
  it("reports missing exchange fills instead of accepting an order as reconciled", async () => {
    const executor = {
      collectOrderEvidence: vi.fn(async () => ({ status: "collected" as const, buys: [{ id: "1", clientOrderId: "CB1", symbol: "BTC/USDT", side: "buy" as const, attachedAlgoClientIds: ["AP1"] }], sells: [], protections: [{ algoClientId: "AP1", symbol: "BTC/USDT", side: "sell" as const, spawnedOrderIds: [] }], orders: [{ id: "1", symbol: "BTC/USDT", side: "buy" as const, filled: 1, terminal: true, ownershipConfirmed: false }], protectionStates: {} })),
      collectFillHistory: vi.fn(async () => ({ status: "collected" as const, fills: [], from: 0, to: 1 })),
      inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "123", mainUid: "123" } }),
      collectAccountCoverage: vi.fn(async () => ({ status: "covered" as const, billCount: 0 })),
    };
    expect(await inspectDemoAccounting({ demoOrderJournal: async () => [row], getDemoBaselineCandidate }, executor)).toMatchObject({ status: "unavailable", reason: "order_fill_total_mismatch" });
  });
  it("rejects incomplete account bill coverage before reading fills", async () => {
    const executor = {
      inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "123", mainUid: "123" } }),
      collectOrderEvidence: async () => ({ status: "collected" as const, buys: [{ id: "1", clientOrderId: "CB1", symbol: "BTC/USDT", side: "buy" as const, attachedAlgoClientIds: ["AP1"] }], sells: [], protections: [{ algoClientId: "AP1", symbol: "BTC/USDT", side: "sell" as const, spawnedOrderIds: [] }], orders: [{ id: "1", symbol: "BTC/USDT", side: "buy" as const, filled: 1, terminal: true, ownershipConfirmed: false }], protectionStates: {} }),
      collectAccountCoverage: async () => ({ status: "unavailable" as const, reason: "unattributed_account_bill" }),
      collectFillHistory: vi.fn(),
    };
    expect(await inspectDemoAccounting({ demoOrderJournal: async () => [row], getDemoBaselineCandidate }, executor)).toMatchObject({ reason: "unattributed_account_bill" });
    expect(executor.collectFillHistory).not.toHaveBeenCalled();
  });
});

