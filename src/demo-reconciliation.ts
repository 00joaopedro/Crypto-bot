import { calculateDemoLedger, type DemoFill, type DemoLedgerResult } from "./demo-ledger.js";

/** Evidence must be established by the exchange history collector and the bot journal.
 * In particular, a protective child order must be linked to its recorded parent.
 */
export type ConfirmedDemoOrder = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  filled: number;
  terminal: boolean;
  ownershipConfirmed: boolean;
};

export function reconcileDemoExecutions(input: {
  historyComplete: boolean;
  orders: ConfirmedDemoOrder[];
  fills: DemoFill[];
}): DemoLedgerResult {
  const unavailable = (reason: string): DemoLedgerResult => ({ status: "unavailable", reason });
  if (!input.historyComplete) return unavailable("execution_history_incomplete");
  const orders = new Map<string, ConfirmedDemoOrder>();
  for (const order of input.orders) {
    if (!order.id || orders.has(order.id) || !order.ownershipConfirmed || !order.terminal || !Number.isFinite(order.filled) || order.filled < 0) {
      return unavailable("order_evidence_incomplete");
    }
    orders.set(order.id, order);
  }
  const totals = new Map<string, number>();
  for (const fill of input.fills) {
    const order = orders.get(fill.orderId);
    if (!order || order.symbol !== fill.symbol || order.side !== fill.side || !Number.isFinite(fill.amount) || fill.amount <= 0) {
      return unavailable("fill_order_mismatch");
    }
    totals.set(fill.orderId, (totals.get(fill.orderId) ?? 0) + fill.amount);
  }
  for (const order of orders.values()) {
    const actual = totals.get(order.id) ?? 0;
    if (Math.abs(actual - order.filled) > Math.max(1e-10, order.filled * 1e-8)) return unavailable("order_fill_total_mismatch");
  }
  return calculateDemoLedger(input.fills, true);
}
