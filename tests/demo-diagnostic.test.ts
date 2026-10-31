import { describe, expect, it, vi } from "vitest";
import { inspectDemoAccounting } from "../src/demo-diagnostic.js";

const balanceReader = { collectAccountBalances: async () => ({ status: "collected" as const, startedAt: Date.now() - 1000, endedAt: Date.now() - 900, balances: { USDT: 0 } }) };
const row = { client_order_id: "CB1", symbol: "BTC/USDT", status: "PLACED", result: { orderId: "1" }, attached_algo_client_id: "AP1", created_at: new Date(Date.now() - 120_000) };
const getDemoBaselineCandidate = async () => ({ observedAt: new Date(Date.now() - 180_000), balances: { USDT: 0 }, evidence: { startedAt: Date.now() - 181_000, accountIdentity: { uid: "123", mainUid: "123" } }, status: "UNVERIFIED" });
describe("Demo accounting diagnostic", () => {
  it("rejects a changed account or a legacy baseline with no identity before exchange history calls", async () => {
    const executor = { ...balanceReader, inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "456", mainUid: "456" } }), collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn(), collectAccountCoverage: vi.fn(async () => ({ status: "covered" as const, billCount: 0 })) };
    expect(await inspectDemoAccounting({ demoOrderJournal: async () => [row], getDemoBaselineCandidate }, executor)).toMatchObject({ reason: "account_identity_mismatch_or_missing" });
    expect(await inspectDemoAccounting({ demoOrderJournal: async () => [row], getDemoBaselineCandidate: async () => ({ ...(await getDemoBaselineCandidate()), evidence: {} }) }, executor)).toMatchObject({ reason: "account_identity_mismatch_or_missing" });
    expect(executor.collectOrderEvidence).not.toHaveBeenCalled();
  });
  it("excludes legacy failures from the new period but still blocks old pending orders", async () => {
    const baseline = { observedAt: new Date(Date.now() - 10_000), balances: { USDT: 5000 }, evidence: { startedAt: Date.now() - 11_000, accountIdentity: { uid: "123", mainUid: "123" } }, status: "UNVERIFIED" };
    const executor = { ...balanceReader, collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn(), collectAccountCoverage: vi.fn(async () => ({ status: "covered" as const, billCount: 0 })), inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "123", mainUid: "123" } }) };
    const failed = { ...row, status: "FAILED" };
    const persistence = { demoOrderJournal: async () => [failed], getDemoBaselineCandidate: async () => baseline };
    expect(await inspectDemoAccounting(persistence, executor)).toMatchObject({ reason: "no_confirmed_orders", journalCounts: { failed: 0, total: 0 } });
    expect(await inspectDemoAccounting({ ...persistence, demoOrderJournal: async () => [{ ...failed, status: "PENDING" }] }, executor)).toMatchObject({ reason: "pending_order" });
  });
  it("summarizes failed and skipped journal entries without exposing errors or asserting exchange rejection", async () => {
    const executor = { ...balanceReader, collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn(), collectAccountCoverage: vi.fn(async () => ({ status: "covered" as const, billCount: 0 })), inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "123", mainUid: "123" } }) };
    const failed = { ...row, status: "FAILED", result: { error: "private error detail" } };
    const skipped = { ...row, status: "SKIPPED" };
    const result = await inspectDemoAccounting({ demoOrderJournal: async () => [failed, skipped], getDemoBaselineCandidate }, executor);
    expect(result).toEqual({ status: "unavailable", reason: "no_confirmed_orders", journalCounts: { failed: 1, skipped: 1, total: 2 } });
    expect(JSON.stringify(result)).not.toContain("private error detail");
    expect(executor.collectOrderEvidence).not.toHaveBeenCalled();
  });
  it("does not query the exchange for an incomplete journal", async () => {
    const executor = { ...balanceReader, collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn(), collectAccountCoverage: vi.fn(async () => ({ status: "covered" as const, billCount: 0 })), inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "123", mainUid: "123" } }) };
    const persistence = { demoOrderJournal: async () => [{ ...row, attached_algo_client_id: null }], getDemoBaselineCandidate };
    expect(await inspectDemoAccounting(persistence, executor)).toMatchObject({ reason: "journal_identity_incomplete" });
    expect(executor.collectOrderEvidence).not.toHaveBeenCalled();
  });
  it("does not ignore an uncertain failure when another order was placed", async () => {
    const executor = { ...balanceReader, collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn(), collectAccountCoverage: vi.fn(async () => ({ status: "covered" as const, billCount: 0 })), inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "123", mainUid: "123" } }) };
    const persistence = { demoOrderJournal: async () => [row, { ...row, status: "FAILED" }], getDemoBaselineCandidate };
    expect(await inspectDemoAccounting(persistence, executor)).toMatchObject({ reason: "failed_order_unconfirmed" });
    expect(executor.collectOrderEvidence).not.toHaveBeenCalled();
  });
  it("refuses invalid journal dates and future baselines", async () => {
    const executor = { ...balanceReader, collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn(), collectAccountCoverage: vi.fn(async () => ({ status: "covered" as const, billCount: 0 })), inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "123", mainUid: "123" } }) };
    expect(await inspectDemoAccounting({ demoOrderJournal: async () => [{ ...row, created_at: new Date(NaN) }], getDemoBaselineCandidate }, executor)).toMatchObject({ reason: "invalid_journal_date" });
    expect(await inspectDemoAccounting({ demoOrderJournal: async () => [row], getDemoBaselineCandidate: async () => ({ ...(await getDemoBaselineCandidate()), observedAt: new Date(Date.now() + 60_000) }) }, executor)).toMatchObject({ reason: "baseline_missing" });
  });
  it("collects evidence without claiming complete accounting", async () => {
    const executor = { ...balanceReader,
      collectOrderEvidence: vi.fn(async () => ({ status: "collected" as const, buys: [{ id: "1", clientOrderId: "CB1", symbol: "BTC/USDT", side: "buy" as const, attachedAlgoClientIds: ["AP1"] }], sells: [], protections: [{ algoClientId: "AP1", symbol: "BTC/USDT", side: "sell" as const, spawnedOrderIds: [] }], orders: [{ id: "1", symbol: "BTC/USDT", side: "buy" as const, filled: 0, terminal: true, ownershipConfirmed: false }], protectionStates: {} })),
      collectFillHistory: vi.fn(async () => ({ status: "collected" as const, fills: [], from: 0, to: 1 })),
      inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "123", mainUid: "123" } }),
      collectAccountCoverage: vi.fn(async () => ({ status: "covered" as const, billCount: 0 })),
    };
    const baseline = await getDemoBaselineCandidate();
    expect(await inspectDemoAccounting({ demoOrderJournal: async () => [row], getDemoBaselineCandidate: async () => baseline }, executor)).toMatchObject({ status: "unavailable", reason: "fills_not_covered_by_account_bills" });
    expect(executor.collectFillHistory).toHaveBeenCalledOnce();
    expect(executor.collectFillHistory).toHaveBeenCalledWith(expect.objectContaining({ from: baseline.observedAt.getTime() }));
  });
  it("reports missing exchange fills instead of accepting an order as reconciled", async () => {
    const executor = { ...balanceReader,
      collectOrderEvidence: vi.fn(async () => ({ status: "collected" as const, buys: [{ id: "1", clientOrderId: "CB1", symbol: "BTC/USDT", side: "buy" as const, attachedAlgoClientIds: ["AP1"] }], sells: [], protections: [{ algoClientId: "AP1", symbol: "BTC/USDT", side: "sell" as const, spawnedOrderIds: [] }], orders: [{ id: "1", symbol: "BTC/USDT", side: "buy" as const, filled: 1, terminal: true, ownershipConfirmed: false }], protectionStates: {} })),
      collectFillHistory: vi.fn(async () => ({ status: "collected" as const, fills: [], from: 0, to: 1 })),
      inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "123", mainUid: "123" } }),
      collectAccountCoverage: vi.fn(async () => ({ status: "covered" as const, billCount: 0 })),
    };
    expect(await inspectDemoAccounting({ demoOrderJournal: async () => [row], getDemoBaselineCandidate }, executor)).toMatchObject({ status: "unavailable", reason: "order_fill_total_mismatch" });
  });
  it("rejects incomplete account bill coverage before reading fills", async () => {
    const executor = { ...balanceReader,
      inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "123", mainUid: "123" } }),
      collectOrderEvidence: async () => ({ status: "collected" as const, buys: [{ id: "1", clientOrderId: "CB1", symbol: "BTC/USDT", side: "buy" as const, attachedAlgoClientIds: ["AP1"] }], sells: [], protections: [{ algoClientId: "AP1", symbol: "BTC/USDT", side: "sell" as const, spawnedOrderIds: [] }], orders: [{ id: "1", symbol: "BTC/USDT", side: "buy" as const, filled: 1, terminal: true, ownershipConfirmed: false }], protectionStates: {} }),
      collectAccountCoverage: async () => ({ status: "unavailable" as const, reason: "unattributed_account_bill" }),
      collectFillHistory: vi.fn(),
    };
    expect(await inspectDemoAccounting({ demoOrderJournal: async () => [row], getDemoBaselineCandidate }, executor)).toMatchObject({ reason: "unattributed_account_bill" });
    expect(executor.collectFillHistory).not.toHaveBeenCalled();
  });
  it("confirms P&L only when owned fills, baseline bills and both balance reads reconcile", async () => {
    const now = Date.now();
    const from = now - 60_000;
    const journalRow = { ...row, created_at: new Date(from + 1000) };
    const baseline = { observedAt: new Date(from), balances: { USDT: 100 }, evidence: { startedAt: from - 100, accountIdentity: { uid: "123", mainUid: "123" } }, status: "UNVERIFIED" };
    const buy = { id: "1", clientOrderId: "CB1", symbol: "BTC/USDT", side: "buy" as const, attachedAlgoClientIds: ["AP1"] };
    const sell = { id: "2", clientOrderId: null, symbol: "BTC/USDT", side: "sell" as const };
    const orders = [{ id: "1", symbol: "BTC/USDT", side: "buy" as const, filled: 1, terminal: true, ownershipConfirmed: false }, { id: "2", symbol: "BTC/USDT", side: "sell" as const, filled: 0.5, terminal: true, ownershipConfirmed: false }];
    const fills = [
      { id: "f1", orderId: "1", symbol: "BTC/USDT", side: "buy" as const, timestamp: from + 2000, amount: 1, costUsdt: 100, fees: [{ currency: "USDT", cost: 1 }] },
      { id: "f2", orderId: "2", symbol: "BTC/USDT", side: "sell" as const, timestamp: from + 3000, amount: 0.5, costUsdt: 60, fees: [{ currency: "USDT", cost: 0.6 }] },
    ];
    const collectAccountCoverage = vi.fn(async (start: number, _end: number, _owned: ReadonlySet<string>, quiescent: number | undefined): Promise<{ status: "covered"; billCount: number } | { status: "unavailable"; reason: string }> => start === from && quiescent !== undefined ? { status: "covered", billCount: 2 } : { status: "covered", billCount: 0 });
    const collectAccountBalances = vi.fn(async () => ({ status: "collected" as const, startedAt: now - 1000, endedAt: now - 900, balances: { BTC: 0.5, USDT: 58.4 } }));
    const executor = {
      inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "123", mainUid: "123" } }),
      collectOrderEvidence: async () => ({ status: "collected" as const, buys: [buy], sells: [sell], protections: [{ algoClientId: "AP1", symbol: "BTC/USDT", side: "sell" as const, spawnedOrderIds: ["2"] }], orders, protectionStates: {} }),
      collectFillHistory: async () => ({ status: "collected" as const, fills, from, to: now - 1000 }),
      collectAccountCoverage, collectAccountBalances,
    };
    const persistence = { demoOrderJournal: async () => [journalRow], getDemoBaselineCandidate: async () => baseline };
    const result = await inspectDemoAccounting(persistence, executor);
    expect(result).toMatchObject({ status: "confirmed", checkedFills: 2, checkedBills: 2 });
    if (result.status === "confirmed") expect(result.realizedPnlUsdt).toBeCloseTo(8.9);
    expect(collectAccountCoverage).toHaveBeenLastCalledWith(from, now - 900, new Set(["1", "2"]), now - 1000);
    expect(collectAccountBalances).toHaveBeenCalledTimes(2);
    collectAccountCoverage.mockImplementation(async (start: number) => start === from ? { status: "unavailable" as const, reason: "account_movement_during_snapshot" } : { status: "covered" as const, billCount: 0 });
    expect(await inspectDemoAccounting(persistence, executor)).toMatchObject({ status: "unavailable", reason: "account_movement_during_snapshot" });
    collectAccountCoverage.mockImplementation(async (start: number) => ({ status: "covered" as const, billCount: start === from ? 2 : 0 }));
    collectAccountBalances.mockImplementationOnce(async () => ({ status: "collected" as const, startedAt: now - 1000, endedAt: now - 900, balances: { BTC: 0.6, USDT: 58.4 } }));
    expect(await inspectDemoAccounting(persistence, executor)).toMatchObject({ status: "unavailable", reason: "balance_changed_during_snapshot" });
  });
});

