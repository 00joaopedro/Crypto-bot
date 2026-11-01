import { describe, expect, it, vi } from "vitest";
import { inspectDemoResume } from "../src/demo-resume.js";

const identity = { uid: "123", mainUid: "123" };
const baseline = { observedAt: new Date(1000), balances: { USDT: 100 }, evidence: { accountIdentity: identity }, status: "UNVERIFIED" };
const persistence = { getDemoBaselineCandidate: async () => baseline, demoOrderJournal: async () => [] };
const executor = { inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity }), inspectTradingPermission: async () => ({ status: "available" as const, trading: true }), collectOrderEvidence: vi.fn() };

describe("safe Demo resume", () => {
  it("allows a matching account with permission and no unresolved journal entries", async () => {
    expect(await inspectDemoResume(persistence, executor)).toEqual({ status: "safe" });
    expect(executor.collectOrderEvidence).not.toHaveBeenCalled();
  });
  it("blocks a different account, uncertain permission and pending order", async () => {
    expect(await inspectDemoResume(persistence, { ...executor, inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "456", mainUid: "456" } }) })).toMatchObject({ reason: "demo_account_identity_unconfirmed" });
    expect(await inspectDemoResume(persistence, { ...executor, inspectTradingPermission: async () => ({ status: "available" as const, trading: false }) })).toMatchObject({ reason: "demo_trading_permission_unconfirmed" });
    const pending = { status: "PENDING", result: {}, attached_algo_client_id: null, client_order_id: "1", symbol: "ETH/USDT", created_at: new Date(2000) };
    expect(await inspectDemoResume({ ...persistence, demoOrderJournal: async () => [pending] }, executor)).toMatchObject({ reason: "pending_demo_order" });
  });
});
