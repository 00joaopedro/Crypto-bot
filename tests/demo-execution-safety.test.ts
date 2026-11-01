import { describe, expect, it, vi } from "vitest";
import { inspectDemoExecutionSafety, inspectDemoExecutionState } from "../src/demo-execution-safety.js";

const baseline = { observedAt: new Date(1000), balances: { USDT: 100 }, evidence: {}, status: "UNVERIFIED" };
const row = { status: "PLACED", result: { orderId: "1" }, attached_algo_client_id: "AP1", client_order_id: "CB1", symbol: "BTC/USDT", created_at: new Date(2000) };
const buy = { id: "1", clientOrderId: "CB1", symbol: "BTC/USDT", side: "buy" as const, attachedAlgoClientIds: ["AP1"] };
const sell = { id: "2", clientOrderId: null, symbol: "BTC/USDT", side: "sell" as const };
const protection = { algoClientId: "AP1", symbol: "BTC/USDT", side: "sell" as const, spawnedOrderIds: ["2"] };
const evidence = { status: "collected" as const, buys: [buy], sells: [sell], protections: [protection], protectionStates: { AP1: "live" }, orders: [
  { id: "1", symbol: "BTC/USDT", side: "buy" as const, filled: 1, terminal: true, ownershipConfirmed: false },
  { id: "2", symbol: "BTC/USDT", side: "sell" as const, filled: 0.5, terminal: true, ownershipConfirmed: false },
] };
const persistence = (rows = [row]) => ({ demoOrderJournal: async () => rows, getDemoBaselineCandidate: async () => baseline });

describe("OKX Demo execution safety gate", () => {
  it("accepts a verified live protection and an already closed position", async () => {
    expect(await inspectDemoExecutionSafety(persistence(), { collectOrderEvidence: async () => evidence })).toEqual({ status: "safe" });
    const closed = { ...evidence, protectionStates: { AP1: "effective" }, orders: [evidence.orders[0]!, { ...evidence.orders[1]!, filled: 1 }] };
    expect(await inspectDemoExecutionSafety(persistence(), { collectOrderEvidence: async () => closed })).toEqual({ status: "safe" });
  });
  it("derives verified Demo exposure from exchange fills, independently of Paper", async () => {
    expect(await inspectDemoExecutionState(persistence(), { collectOrderEvidence: async () => evidence })).toEqual({ status: "safe", positions: [{ symbol: "BTC/USDT", quantity: 0.5 }] });
    const closed = { ...evidence, protectionStates: { AP1: "effective" }, orders: [evidence.orders[0]!, { ...evidence.orders[1]!, filled: 1 }] };
    expect(await inspectDemoExecutionState(persistence(), { collectOrderEvidence: async () => closed })).toEqual({ status: "safe", positions: [] });
    expect(await inspectDemoExecutionState(persistence([{ ...row, status: "REJECTED_CONFIRMED" }]), { collectOrderEvidence: async () => evidence })).toEqual({ status: "safe", positions: [] });
  });
  it("does not infer zero exposure from an unfinished order", async () => {
    const unknown = { ...evidence, orders: [{ ...evidence.orders[0]!, terminal: false, filled: 0 }, { ...evidence.orders[1]!, filled: 0 }] };
    expect(await inspectDemoExecutionState(persistence(), { collectOrderEvidence: async () => unknown })).toMatchObject({ status: "blocked", reason: "demo_buy_not_terminal" });
    const selling = { ...evidence, orders: [evidence.orders[0]!, { ...evidence.orders[1]!, terminal: false }] };
    expect(await inspectDemoExecutionState(persistence(), { collectOrderEvidence: async () => selling })).toMatchObject({ status: "blocked", reason: "demo_sell_not_terminal" });
  });
  it("blocks partial exits without a remaining live protection, overfills, and unknown ownership", async () => {
    expect(await inspectDemoExecutionSafety(persistence(), { collectOrderEvidence: async () => ({ ...evidence, protectionStates: { AP1: "effective" } }) })).toMatchObject({ reason: "demo_position_without_live_protection" });
    expect(await inspectDemoExecutionSafety(persistence(), { collectOrderEvidence: async () => ({ ...evidence, orders: [evidence.orders[0]!, { ...evidence.orders[1]!, filled: 1.1 }] }) })).toMatchObject({ reason: "demo_oversold_position" });
    expect(await inspectDemoExecutionSafety(persistence(), { collectOrderEvidence: async () => ({ ...evidence, buys: [{ ...buy, clientOrderId: "manual" }] }) })).toMatchObject({ reason: "buy_identity_mismatch" });
  });
  it("fails closed on pending or failed submission, but ignores a pre-baseline legacy failure", async () => {
    const reader = vi.fn(async () => evidence);
    expect(await inspectDemoExecutionSafety(persistence([{ ...row, status: "PENDING" }]), { collectOrderEvidence: reader })).toMatchObject({ reason: "pending_demo_order" });
    expect(await inspectDemoExecutionSafety(persistence([{ ...row, status: "FAILED" }]), { collectOrderEvidence: reader })).toMatchObject({ reason: "unresolved_demo_failure" });
    expect(await inspectDemoExecutionSafety(persistence([{ ...row, status: "SKIPPED" }]), { collectOrderEvidence: reader })).toMatchObject({ reason: "paper_demo_entry_mismatch" });
    expect(reader).not.toHaveBeenCalled();
    expect(await inspectDemoExecutionSafety(persistence([{ ...row, status: "FAILED", created_at: new Date(0) }]), { collectOrderEvidence: reader })).toEqual({ status: "safe" });
    expect(await inspectDemoExecutionSafety(persistence([{ ...row, status: "REJECTED_CONFIRMED" }]), { collectOrderEvidence: reader })).toEqual({ status: "safe" });
  });
});
