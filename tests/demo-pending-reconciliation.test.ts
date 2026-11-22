import { describe, expect, it, vi } from "vitest";
import { reconcilePendingDemoOrders } from "../src/demo-pending-reconciliation.js";

const identity = { uid: "123", mainUid: "123" };
const baseline = { observedAt: new Date(1000), balances: { USDT: 1 }, evidence: { accountIdentity: identity }, status: "UNVERIFIED" };
const pendingDemoOrders = async () => [{ symbol: "ETH/USDT", client_order_id: "CB1" }];
const getDemoBaselineCandidate = async () => baseline;

describe("pending Demo order reconciliation", () => {
  it("correlates a missing order only after confirming the account", async () => {
    const confirmMissingPermissionRejectedOrder = vi.fn(async () => true);
    const persistence = { pendingDemoOrders, getDemoBaselineCandidate, confirmMissingPermissionRejectedOrder, reconcileDemoOrder: vi.fn() };
    const executor = { reconcileOrder: vi.fn(async () => null), inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity }) };
    await reconcilePendingDemoOrders(persistence, executor);
    expect(executor.reconcileOrder).toHaveBeenCalledWith("ETH/USDT", "CB1");
    expect(confirmMissingPermissionRejectedOrder).toHaveBeenCalledWith("CB1", "123:123");
  });
  it("does not resolve when the lookup fails or the account is different", async () => {
    const confirmMissingPermissionRejectedOrder = vi.fn(async () => true);
    const persistence = { pendingDemoOrders, getDemoBaselineCandidate, confirmMissingPermissionRejectedOrder, reconcileDemoOrder: vi.fn() };
    const executor = { reconcileOrder: vi.fn(async (): Promise<null> => { throw new Error("temporary"); }), inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity }) };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await reconcilePendingDemoOrders(persistence, executor);
    expect(confirmMissingPermissionRejectedOrder).not.toHaveBeenCalled();
    const wrongAccountLookup = vi.fn(async () => null);
    await reconcilePendingDemoOrders(persistence, { ...executor, reconcileOrder: wrongAccountLookup, inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity: { uid: "999", mainUid: "999" } }) });
    expect(confirmMissingPermissionRejectedOrder).not.toHaveBeenCalled();
    expect(wrongAccountLookup).not.toHaveBeenCalled();
    log.mockRestore();
  });
});


it('reconciles an order actually found instead of inferring a rejection or submitting it again', async () => {
  const confirmMissingPermissionRejectedOrder = vi.fn();
  const reconcileDemoOrder = vi.fn();
  const order = { id: 'exchange-id', clientOrderId: 'CB1', symbol: 'ETH/USDT', side: 'buy' };
  const store = { pendingDemoOrders, getDemoBaselineCandidate, confirmMissingPermissionRejectedOrder, reconcileDemoOrder };
  const executor = { inspectAccountIdentity: async () => ({ status: 'confirmed' as const, identity }), reconcileOrder: async () => order as never };
  await reconcilePendingDemoOrders(store, executor);
  expect(reconcileDemoOrder).toHaveBeenCalledWith('CB1', order);
  expect(confirmMissingPermissionRejectedOrder).not.toHaveBeenCalled();
});
