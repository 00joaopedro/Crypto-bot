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
  return reconcileDemoExecutions({
    historyComplete: true,
    orders: orders.map((order) => ({ id: order.id, symbol: order.symbol, side: order.side, filled: order.filled, terminal: order.terminal, ownershipConfirmed: true })),
    fills: input.fills,
  });
}
