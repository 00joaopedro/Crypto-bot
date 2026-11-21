import { describe, expect, it, vi } from "vitest";
import { inspectDemoResume } from "../src/demo-resume.js";

const identity = { uid: "123", mainUid: "123" };
const baseline = { observedAt: new Date(1000), balances: { USDT: 100 }, evidence: { accountIdentity: identity }, status: "UNVERIFIED" };
const limits = { maxDailyLoss: 0.03, maxDrawdown: 0.1 };
const observeDemoRisk = vi.fn(async (_account: string, equity: number, observedAt: number) => ({ day: "2026-11-15", dayStartEquity: 100, peakEquity: 100, equity, observedAt }));
const persistence = { observeDemoRisk, getDemoBaselineCandidate: async () => baseline, demoOrderJournal: async () => [] };
const snapshot = { equityUsdt: 100, quoteFree: 100, totalUsdt: 100, quoteCurrency: "USDT", unvaluedAssets: [], updatedAt: "" };
const executor = { getAccountSnapshot: async () => snapshot, inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity }), inspectTradingPermission: async () => ({ status: "available" as const, trading: true }), collectOrderEvidence: vi.fn() };

describe("safe Demo resume", () => {
  it("allows a matching account with permission and no unresolved journal entries", async () => {
    expect(await inspectDemoResume(persistence, executor, limits)).toEqual({ status: "safe" });
    expect(executor.collectOrderEvidence).not.toHaveBeenCalled();
  });
  it("blocks a different account, uncertain permission and pending order", async () => {
    expect(await inspectDemoResume(persistence, { ...executor, inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "456", mainUid: "456" } }) }, limits)).toMatchObject({ reason: "demo_account_identity_unconfirmed" });
    expect(await inspectDemoResume(persistence, { ...executor, inspectTradingPermission: async () => ({ status: "available" as const, trading: false }) }, limits)).toMatchObject({ reason: "demo_trading_permission_unconfirmed" });
    const pending = { status: "PENDING", result: {}, attached_algo_client_id: null, client_order_id: "1", symbol: "ETH/USDT", created_at: new Date(2000) };
    expect(await inspectDemoResume({ ...persistence, demoOrderJournal: async () => [pending] }, executor, limits)).toMatchObject({ reason: "pending_demo_order" });
  });

  it("blocks unconfirmed balances before recording risk and enforces the daily loss limit", async () => {
    observeDemoRisk.mockClear();
    for (const invalid of [{ equityUsdt: null }, { quoteFree: null }, { equityUsdt: 0 }, { quoteFree: 101 }]) {
      const getAccountSnapshot = async () => ({ ...snapshot, ...invalid });
      expect(await inspectDemoResume(persistence, { ...executor, getAccountSnapshot }, limits))
        .toEqual({ status: "blocked", reason: "demo_balance_unconfirmed" });
    }
    expect(observeDemoRisk).not.toHaveBeenCalled();
    const getAccountSnapshot = async () => ({ ...snapshot, equityUsdt: 96, quoteFree: 96 });
    expect(await inspectDemoResume(persistence, { ...executor, getAccountSnapshot }, limits))
      .toMatchObject({ status: "blocked", reason: "demo_daily_loss_limit", riskEvidence: { scope: "account", equityUsdt: 96, dayStartEquityUsdt: 100, dailyLossRate: .04, maxDailyLoss: .03 } });
    expect(observeDemoRisk).toHaveBeenCalledWith("123:123", 96, expect.any(Number));
  });
});
