import type { PostgresPersistence } from "./persistence.js";
import type { OkxDemoExecutor } from "./okx-demo.js";
import type { JournaledDemoBuy } from "./demo-ownership.js";
import { verifyDemoOwnership } from "./demo-ownership.js";

/** On-demand read-only inspection; this intentionally does not assert P&L coverage. */
export async function inspectDemoAccounting(persistence: Pick<PostgresPersistence, "demoOrderJournal">, executor: Pick<OkxDemoExecutor, "collectOrderEvidence" | "collectFillHistory">) {
  const unavailable = (reason: string) => ({ status: "unavailable" as const, reason });
  const rows = await persistence.demoOrderJournal();
  if (!rows.length) return unavailable("journal_empty");
  if (rows.length > 50) return unavailable("journal_too_large_for_diagnostic");
  if (rows.some((row) => row.status === "PENDING")) return unavailable("pending_order");
  const placed = rows.filter((row) => row.status === "PLACED");
  if (!placed.length) return unavailable("no_confirmed_orders");
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
  const from = Math.min(...placed.map((row) => new Date(row.created_at).getTime())) - 60_000;
  if (!Number.isSafeInteger(from) || from < 0) return unavailable("invalid_journal_date");
  const to = Date.now();
  let fillCount = 0;
  for (const symbol of new Set(journal.map((item) => item.symbol))) {
    const fills = await executor.collectFillHistory({ symbol, from, to });
    if (fills.status !== "collected") return unavailable(fills.reason);
    fillCount += fills.fills.length;
  }
  return { status: "unavailable" as const, reason: "coverage_and_positions_unconfirmed", checkedOrders: evidence.orders.length, checkedFills: fillCount };
}
