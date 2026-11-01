import { verifyDemoOwnership } from "./demo-ownership.js";
import type { PostgresPersistence } from "./persistence.js";
import type { OkxDemoExecutor } from "./okx-demo.js";

/** Gross filled quantity; exchange fees in the base asset are not subtracted.
 * This is unsuitable for sizing sells or proving available balances. */
export type VerifiedDemoPosition = { symbol: string; quantity: number };
export type DemoExecutionState =
  | { status: "safe"; positions: VerifiedDemoPosition[] }
  | { status: "blocked"; reason: string };

/** Derive positions only from bot-owned, verified exchange fills and protection.
 * This snapshot is evidence for diagnostics; it does not authorize a new order.
 */
export async function inspectDemoExecutionState(
  persistence: Pick<PostgresPersistence, "demoOrderJournal" | "getDemoBaselineCandidate">,
  executor: Pick<OkxDemoExecutor, "collectOrderEvidence">,
): Promise<DemoExecutionState> {
  const blocked = (reason: string) => ({ status: "blocked" as const, reason });
  try {
    const rows = await persistence.demoOrderJournal();
    if (rows.some((row) => row.status === "PENDING")) return blocked("pending_demo_order");
    if (rows.some((row) => !Number.isSafeInteger(new Date(row.created_at).getTime()))) return blocked("demo_journal_date_invalid");
    const baseline = await persistence.getDemoBaselineCandidate();
    if (!baseline) return blocked("demo_baseline_missing");
    const relevant = rows.filter((row) => new Date(row.created_at).getTime() >= baseline.observedAt.getTime());
    // An ambiguous local failure may still have reached the exchange.
    if (relevant.some((row) => row.status === "FAILED")) return blocked("unresolved_demo_failure");
    // A skipped Demo buy still leaves the Paper position opened in this cycle.
    if (relevant.some((row) => row.status === "SKIPPED")) return blocked("paper_demo_entry_mismatch");
    if (relevant.some((row) => !["PLACED", "SKIPPED", "REJECTED_CONFIRMED"].includes(row.status))) return blocked("unknown_demo_order_status");
    const placed = relevant.filter((row) => row.status === "PLACED");
    if (!placed.length) return { status: "safe", positions: [] };
    if (placed.length > 500) return blocked("demo_journal_too_large");
    const journal = [];
    for (const row of placed) {
      const orderId = (row.result as { orderId?: unknown } | null)?.orderId;
      if (typeof orderId !== "string" || !orderId || !row.attached_algo_client_id) return blocked("demo_order_identity_missing");
      journal.push({ orderId, clientOrderId: row.client_order_id, symbol: row.symbol, attachedAlgoClientId: row.attached_algo_client_id });
    }
    const evidence = await executor.collectOrderEvidence(journal);
    if (evidence.status !== "collected") return blocked(evidence.reason);
    const ownership = verifyDemoOwnership(journal, evidence.buys, evidence.protections, evidence.sells);
    if (ownership.status !== "confirmed") return blocked(ownership.reason);
    const orders = new Map(evidence.orders.map((order) => [order.id, order]));
    if (orders.size !== ownership.ownedOrderIds.length || orders.size !== evidence.orders.length) return blocked("demo_order_set_mismatch");
    const positions = new Map<string, number>();
    for (const buy of journal) {
      const parent = orders.get(buy.orderId);
      const protection = evidence.protections.find((item) => item.algoClientId === buy.attachedAlgoClientId);
      if (!parent || !protection || !Number.isFinite(parent.filled) || parent.filled < 0) return blocked("demo_position_unconfirmed");
      let sold = 0;
      for (const id of protection.spawnedOrderIds) {
        const child = orders.get(id);
        if (!child || !Number.isFinite(child.filled) || child.filled < 0) return blocked("demo_position_unconfirmed");
        if (!child.terminal) return blocked("demo_sell_not_terminal");
        sold += child.filled;
      }
      if (sold > parent.filled * (1 + 1e-8)) return blocked("demo_oversold_position");
      const remaining = parent.filled - sold;
      if (remaining > Math.max(parent.filled * 1e-8, 1e-12) && evidence.protectionStates[buy.attachedAlgoClientId] !== "live") return blocked("demo_position_without_live_protection");
      if (!parent.terminal) return blocked("demo_buy_not_terminal");
      if (remaining > Math.max(parent.filled * 1e-8, 1e-12)) {
        positions.set(buy.symbol, (positions.get(buy.symbol) ?? 0) + remaining);
      }
    }
    return { status: "safe", positions: [...positions].map(([symbol, quantity]) => ({ symbol, quantity })) };
  } catch { return blocked("demo_safety_check_failed"); }
}

/** Compatibility gate: consumers must explicitly opt in to the position snapshot. */
export async function inspectDemoExecutionSafety(
  persistence: Pick<PostgresPersistence, "demoOrderJournal" | "getDemoBaselineCandidate">,
  executor: Pick<OkxDemoExecutor, "collectOrderEvidence">,
): Promise<{ status: "safe" } | { status: "blocked"; reason: string }> {
  const result = await inspectDemoExecutionState(persistence, executor);
  return result.status === "safe" ? { status: "safe" } : result;
}
