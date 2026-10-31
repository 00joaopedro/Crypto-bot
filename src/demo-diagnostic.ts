import type { PostgresPersistence } from "./persistence.js";
import type { OkxDemoExecutor } from "./okx-demo.js";
import type { JournaledDemoBuy } from "./demo-ownership.js";
import { verifyDemoOwnership } from "./demo-ownership.js";
import { reconcileDemoExecutions } from "./demo-reconciliation.js";
import type { DemoFill } from "./demo-ledger.js";
import { sameDemoAccount } from "./okx-demo-identity.js";
import { accountForDemoEvidence } from "./demo-accounting-evidence.js";

/** On-demand read-only inspection; confirms P&L only with a stable bounded balance window. */
export async function inspectDemoAccounting(persistence: Pick<PostgresPersistence, "demoOrderJournal" | "getDemoBaselineCandidate">, executor: Pick<OkxDemoExecutor, "collectOrderEvidence" | "collectFillHistory" | "inspectAccountIdentity" | "collectAccountCoverage" | "collectAccountBalances">) {
  const unavailable = (reason: string) => ({ status: "unavailable" as const, reason });
  const rows = await persistence.demoOrderJournal();
  if (!rows.length) return unavailable("journal_empty");
  if (rows.some((row) => row.status === "PENDING")) return unavailable("pending_order");
  const baseline = await persistence.getDemoBaselineCandidate();
  if (!baseline || !Number.isSafeInteger(baseline.observedAt.getTime()) || baseline.observedAt.getTime() <= 0 || baseline.observedAt.getTime() > Date.now()) return unavailable("baseline_missing");
  const account = await executor.inspectAccountIdentity();
  if (account.status !== "confirmed") return unavailable(account.reason);
  if (!sameDemoAccount(baseline.evidence.accountIdentity, account.identity)) return unavailable("account_identity_mismatch_or_missing");
  const baselineStartedAt = baseline.evidence.startedAt;
  if (baseline.status !== "UNVERIFIED" || !Number.isSafeInteger(baselineStartedAt) || (baselineStartedAt as number) <= 0 || (baselineStartedAt as number) > baseline.observedAt.getTime()) return unavailable("baseline_snapshot_unconfirmed");
  // A balance collected between these local times is usable only if OKX reports
  // no balance-changing bill throughout the entire baseline request.
  const baselineWindow = await executor.collectAccountCoverage(baselineStartedAt as number, baseline.observedAt.getTime(), new Set(), baselineStartedAt as number);
  if (baselineWindow.status !== "covered") return unavailable(baselineWindow.reason);
  if (rows.some((row) => !Number.isSafeInteger(new Date(row.created_at).getTime()))) return unavailable("invalid_journal_date");
  const periodRows = rows.filter((row) => new Date(row.created_at).getTime() >= baseline.observedAt.getTime());
  const placed = periodRows.filter((row) => row.status === "PLACED");
  if (!placed.length) {
    // A local failure alone does not prove that OKX rejected a submission.
    // Do not return raw errors: exchange messages may contain sensitive data.
    const failed = periodRows.filter((row) => row.status === "FAILED").length;
    const skipped = periodRows.filter((row) => row.status === "SKIPPED").length;
    return { ...unavailable("no_confirmed_orders"), journalCounts: { failed, skipped, total: periodRows.length } };
  }
  // A local failure is not proof that the exchange rejected the order. This
  // applies even if other orders in the same period were confirmed.
  if (periodRows.some((row) => row.status === "FAILED")) return unavailable("failed_order_unconfirmed");
  if (periodRows.some((row) => !["PLACED", "SKIPPED", "FAILED"].includes(row.status))) return unavailable("journal_status_unconfirmed");
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
  const before = await executor.collectAccountBalances();
  if (before.status !== "collected") return unavailable(before.reason);
  // A second balance and a final bill scan bracket all exchange requests. Any
  // activity after the first balance request began invalidates this inspection.
  const from = baseline.observedAt.getTime();
  if (!Number.isSafeInteger(from) || from < 0) return unavailable("invalid_journal_date");
  const to = before.startedAt;
  if (from > to) return unavailable("baseline_snapshot_unconfirmed");
  const collectedFills: DemoFill[] = [];
  for (const symbol of new Set(journal.map((item) => item.symbol))) {
    const fills = await executor.collectFillHistory({ symbol, from, to });
    if (fills.status !== "collected") return unavailable(fills.reason);
    collectedFills.push(...fills.fills);
  }
  const after = await executor.collectAccountBalances();
  if (after.status !== "collected") return unavailable(after.reason);
  const coverage = await executor.collectAccountCoverage(from, after.endedAt, ownedIds, before.startedAt);
  if (coverage.status !== "covered") return unavailable(coverage.reason);
  const assets = new Set([...Object.keys(before.balances), ...Object.keys(after.balances)]);
  if ([...assets].some((asset) => (before.balances[asset] ?? 0) !== (after.balances[asset] ?? 0))) return unavailable("balance_changed_during_snapshot");
  const consistency = reconcileDemoExecutions({
    historyComplete: true,
    orders: evidence.orders.map((order) => ({ ...order, ownershipConfirmed: true })),
    fills: collectedFills,
  });
  if (consistency.status !== "confirmed") return unavailable(consistency.reason);
  if (!collectedFills.length || coverage.billCount < collectedFills.length) return unavailable("fills_not_covered_by_account_bills");
  const byId = new Map(evidence.orders.map((order) => [order.id, order]));
  const withExecution = <T extends { id: string }>(order: T) => ({ ...order, filled: byId.get(order.id)?.filled ?? NaN, terminal: byId.get(order.id)?.terminal ?? false });
  const accounting = accountForDemoEvidence({
    journalComplete: true, historyComplete: true, positionsReconciled: true,
    baseline: { confirmed: true, timestamp: from, balances: baseline.balances },
    positionBalances: before.balances, positionBalancesTimestamp: to,
    coverageStart: from, coverageEnd: to, journal,
    buys: evidence.buys.map(withExecution), protections: evidence.protections,
    sells: evidence.sells.map(withExecution), fills: collectedFills,
  });
  if (accounting.status !== "confirmed") return unavailable(accounting.reason);
  return { status: "confirmed" as const, realizedPnlUsdt: accounting.realizedPnlUsdt, positions: accounting.positions, checkedOrders: evidence.orders.length, checkedFills: collectedFills.length, checkedBills: coverage.billCount };
}

