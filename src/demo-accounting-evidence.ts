import type { DemoFill, DemoLedgerResult } from "./demo-ledger.js";
import { verifyDemoOwnership, type JournaledDemoBuy, type ExchangeDemoOrder, type ExchangeProtection } from "./demo-ownership.js";
import { reconcileDemoExecutions } from "./demo-reconciliation.js";

export type ExecutedDemoOrder = ExchangeDemoOrder & { filled: number; terminal: boolean };

/** Evidence must originate from the exchange and durable journal, not guesses.
 * The coverage flags have to be established independently of page exhaustion.
 */
export function accountForDemoEvidence(input: {
  journalComplete: boolean;
  historyComplete: boolean;
  positionsReconciled: boolean;
  /** Independently verified total balances before this accounting window. */
  baseline: { confirmed: boolean; timestamp: number; balances: Record<string, number> };
  /** Total (free + locked) Demo balances, captured at the coverage endpoint. */
  positionBalances: Record<string, number>;
  positionBalancesTimestamp: number;
  coverageStart: number;
  coverageEnd: number;
  journal: JournaledDemoBuy[];
  buys: ExecutedDemoOrder[];
  protections: ExchangeProtection[];
  sells: ExecutedDemoOrder[];
  fills: DemoFill[];
}): DemoLedgerResult {
  const unavailable = (reason: string): DemoLedgerResult => ({ status: "unavailable", reason });
  if (!input.journalComplete || !input.historyComplete || !input.positionsReconciled) return unavailable("evidence_coverage_incomplete");
  if (!Number.isSafeInteger(input.coverageStart) || !Number.isSafeInteger(input.coverageEnd) || input.coverageStart < 0 || input.coverageStart > input.coverageEnd) return unavailable("invalid_coverage_window");
  if (!input.baseline?.confirmed || input.baseline.timestamp !== input.coverageStart || !input.baseline.balances || typeof input.baseline.balances !== "object" || Array.isArray(input.baseline.balances)) return unavailable("baseline_unconfirmed");
  for (const [asset, balance] of Object.entries(input.baseline.balances)) {
    if (!/^[A-Z0-9]+$/.test(asset) || typeof balance !== "number" || !Number.isFinite(balance) || balance < 0) return unavailable("invalid_baseline_balance");
  }
  if (input.positionBalancesTimestamp !== input.coverageEnd || !input.positionBalances || typeof input.positionBalances !== "object" || Array.isArray(input.positionBalances)) return unavailable("position_snapshot_unconfirmed");
  // An empty input set cannot establish an initial accounting baseline.
  if (input.journal.length === 0) return unavailable("baseline_unconfirmed");
  if (input.buys.some((order) => order.side !== "buy") || input.sells.some((order) => order.side !== "sell")) return unavailable("invalid_order_side");
  if (input.buys.length !== input.journal.length) return unavailable("unattributed_buy");
  if (input.fills.some((fill) => !Number.isSafeInteger(fill.timestamp) || fill.timestamp < input.coverageStart || fill.timestamp > input.coverageEnd)) return unavailable("fill_outside_coverage");
  const ownership = verifyDemoOwnership(input.journal, input.buys, input.protections, input.sells);
  if (ownership.status !== "confirmed") return ownership;
  const orders = [...input.buys, ...input.sells];
  if (orders.length !== ownership.ownedOrderIds.length) return unavailable("order_set_mismatch");
  const owned = new Set(ownership.ownedOrderIds);
  if (orders.some((order) => !owned.has(order.id))) return unavailable("order_set_mismatch");
  const result = reconcileDemoExecutions({
    historyComplete: true,
    orders: orders.map((order) => ({ id: order.id, symbol: order.symbol, side: order.side, filled: order.filled, terminal: order.terminal, ownershipConfirmed: true })),
    fills: input.fills,
  });
  if (result.status !== "confirmed") return result;
  // Compare whole-account total balances, including locked funds. A caller must
  // separately establish isolation and that the snapshot and history describe
  // the same instant; matching quantities alone does not establish either.
  const expectedAssets = new Set<string>();
  for (const [symbol, position] of Object.entries(result.positions)) {
    const asset = symbol.split("/")[0]!;
    if (expectedAssets.has(asset)) return unavailable("ambiguous_position_asset");
    expectedAssets.add(asset);
    if (!Object.hasOwn(input.baseline.balances, asset)) return unavailable("baseline_balance_missing");
    const actual = input.positionBalances[asset];
    if (typeof actual !== "number" || !Number.isFinite(actual) || actual < 0) return unavailable("position_balance_missing");
    const expected = input.baseline.balances[asset]! + position.quantity;
    if (!Number.isFinite(expected) || Math.abs(actual - expected) > Math.max(actual, expected) * 1e-8) return unavailable("position_balance_mismatch");
  }
  for (const [asset, baseline] of Object.entries(input.baseline.balances)) {
    if (asset === "USDT" || expectedAssets.has(asset)) continue;
    const actual = input.positionBalances[asset];
    if (typeof actual !== "number" || !Number.isFinite(actual) || actual < 0) return unavailable("position_balance_missing");
    if (Math.abs(actual - baseline) > Math.max(actual, baseline) * 1e-8) return unavailable("position_balance_mismatch");
    expectedAssets.add(asset);
  }
  for (const [asset, balance] of Object.entries(input.positionBalances)) {
    if (typeof balance !== "number" || !Number.isFinite(balance) || balance < 0) return unavailable("invalid_position_balance");
    if (asset !== "USDT" && !expectedAssets.has(asset) && balance !== 0) return unavailable("unattributed_position_balance");
  }
  return result;
}

