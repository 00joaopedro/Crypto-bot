import type { PostgresPersistence } from "./persistence.js";
import type { OkxDemoExecutor } from "./okx-demo.js";
import type { JournaledDemoBuy } from "./demo-ownership.js";
import { verifyDemoOwnership } from "./demo-ownership.js";
import { reconcileDemoExecutions } from "./demo-reconciliation.js";
import type { DemoFill } from "./demo-ledger.js";

/** On-demand read-only inspection; this intentionally does not assert P&L coverage. */
export async function inspectDemoAccounting(persistence: Pick<PostgresPersistence, "demoOrderJournal" | "getDemoBaselineCandidate">, executor: Pick<OkxDemoExecutor, "collectOrderEvidence" | "collectFillHistory">) {
  const unavailable = (reason: string) => ({ status: "unavailable" as const, reason });
  const rows = await persistence.demoOrderJournal();
  if (!rows.length) return unavailable("journal_empty");
  if (rows.some((row) => row.status === "PENDING")) return unavailable("pending_order");
  const baseline = await persistence.getDemoBaselineCandidate();
  if (!baseline || !Number.isFinite(baseline.observedAt.getTime())) return unavailable("baseline_missing");
  const periodRows = rows.filter((row) => new Date(row.created_at).getTime() >= baseline.observedAt.getTime());
  const placed = periodRows.filter((row) => row.status === "PLACED");
  if (!placed.length) {
    // A local failure alone does not prove that OKX rejected a submission.
    // Do not return raw errors: exchange messages may contain sensitive data.
    const failed = periodRows.filter((row) => row.status === "FAILED").length;
    const skipped = periodRows.filter((row) => row.status === "SKIPPED").length;
    return { ...unavailable("no_confirmed_orders"), journalCounts: { failed, skipped, total: periodRows.length } };
  }
  if (placed.length > 50) return unavailable("journal_too_large_for_diagnostic");
  const journal: JournaledDemoBuy[] = [];
  for (const row of placed) {
    const data = row.result as { orderId?: unknown } | null;
    if (!data || typeof data.orderId !== "string" || !data.orderId || !row.attached_algo_client_id) return unavailable("journal_identity_incomplete");
    journal.push({ orderId: data.orderId, clientOrderId: row.client_order_id, symbol: row.symbol, attachedAlgoClientId: row.attached_algo_client_id });
  }
  const evidence = await executor.collectOrderEvidence(journal);
  if (evidence.status !== "collected") return unavailable(evidence.reason);
  const ownership = verifyDemoOwnership(journal, evidence.buys, evidence.protections, evidence.sells);
  if (ownership.status !== "confirmed") return unavailable(ownership.reason);
  const ownedIds = new Set(ownership.ownedOrderIds);
  if (evidence.orders.length !== ownedIds.size || evidence.orders.some((order) => !ownedIds.has(order.id)) || new Set(evidence.orders.map((order) => order.id)).size !== evidence.orders.length) return unavailable("order_set_mismatch");
  const from = Math.min(...placed.map((row) => new Date(row.created_at).getTime())) - 60_000;
  if (!Number.isSafeInteger(from) || from < 0) return unavailable("invalid_journal_date");
  const to = Date.now();
  const collectedFills: DemoFill[] = [];
  for (const symbol of new Set(journal.map((item) => item.symbol))) {
    const fills = await executor.collectFillHistory({ symbol, from, to });
    if (fills.status !== "collected") return unavailable(fills.reason);
    collectedFills.push(...fills.fills);
  }
  // This checks internal consistency only. A paginated response cannot prove
  // coverage, baseline, or account isolation; never expose this provisional P&L.
  const consistency = reconcileDemoExecutions({
    historyComplete: true,
    orders: evidence.orders.map((order) => ({ ...order, ownershipConfirmed: true })),
    fills: collectedFills,
  });
  if (consistency.status !== "confirmed") return unavailable(consistency.reason);
  return { status: "unavailable" as const, reason: "coverage_and_positions_unconfirmed", checkedOrders: evidence.orders.length, checkedFills: collectedFills.length };
}

