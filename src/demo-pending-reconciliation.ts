import { sameDemoAccount } from "./okx-demo-identity.js";
import type { PostgresPersistence } from "./persistence.js";
import type { OkxDemoExecutor } from "./okx-demo.js";

export async function reconcilePendingDemoOrders(
  persistence: Pick<PostgresPersistence, "pendingDemoOrders" | "reconcileDemoOrder" | "getDemoBaselineCandidate" | "confirmMissingPermissionRejectedOrder">,
  executor: Pick<OkxDemoExecutor, "reconcileOrder" | "inspectAccountIdentity">,
): Promise<void> {
  for (const pending of await persistence.pendingDemoOrders()) {
    try {
      const baseline = await persistence.getDemoBaselineCandidate();
      const account = await executor.inspectAccountIdentity();
      if (!baseline || account.status !== "confirmed" || !sameDemoAccount(baseline.evidence.accountIdentity, account.identity)) continue;
      const order = await executor.reconcileOrder(pending.symbol, pending.client_order_id);
      if (order) {
        if (order.clientOrderId !== pending.client_order_id || order.symbol !== pending.symbol || order.side !== "buy") {
          console.error(JSON.stringify({ event: "okx_reconciliation_identity_mismatch", symbol: pending.symbol }));
          continue;
        }
        await persistence.reconcileDemoOrder(pending.client_order_id, order);
        continue;
      }
      const resolved = await persistence.confirmMissingPermissionRejectedOrder(pending.client_order_id);
      if (resolved) console.log(JSON.stringify({ event: "demo_permission_rejection_reconciled", symbol: pending.symbol }));
    } catch {
      // No raw exchange errors or client identifiers in logs. Retry next cycle;
      // never turn an unavailable lookup into an assumed rejection.
      console.error(JSON.stringify({ event: "okx_reconciliation_failed", symbol: pending.symbol }));
    }
  }
}
