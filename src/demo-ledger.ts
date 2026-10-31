/** Pure accounting over a complete, bot-owned, exchange-confirmed execution set.
 * Callers must establish ownership, coverage, order finality and fee completeness.
 */
export type DemoFill = {
  id: string;
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  timestamp: number;
  amount: number;
  costUsdt: number;
  fees: Array<{ currency: string; cost: number }>;
};

export type DemoLedgerResult =
  | { status: "unavailable"; reason: string }
  | { status: "confirmed"; realizedPnlUsdt: number; positions: Record<string, { quantity: number; costUsdt: number }> };

type Lot = { quantity: number; cost: number };

export function calculateDemoLedger(fills: DemoFill[], coverageConfirmed: boolean): DemoLedgerResult {
  const unavailable = (reason: string): DemoLedgerResult => ({ status: "unavailable", reason });
  if (!coverageConfirmed) return unavailable("execution_history_incomplete");
  const ids = new Set<string>();
  const times = new Map<string, "buy" | "sell">();
  const lots = new Map<string, Lot[]>();
  let pnl = 0;
  for (const fill of [...fills].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))) {
    const [base, quote, extra] = fill.symbol.split("/");
    if (!fill.id || !fill.orderId || ids.has(fill.id) || !base || quote !== "USDT" || extra !== undefined || !Number.isFinite(fill.timestamp) || !Number.isFinite(fill.amount) || fill.amount <= 0 || !Number.isFinite(fill.costUsdt) || fill.costUsdt <= 0 || !Array.isArray(fill.fees) || fill.fees.length === 0) return unavailable("invalid_or_incomplete_fill");
    ids.add(fill.id);
    const timeKey = `${fill.symbol}:${fill.timestamp}`;
    const previousSide = times.get(timeKey);
    if (previousSide && previousSide !== fill.side) return unavailable("ambiguous_execution_order");
    times.set(timeKey, fill.side);
    let baseFee = 0; let quoteFee = 0;
    for (const fee of fill.fees) {
      if (!Number.isFinite(fee.cost) || fee.cost < 0) return unavailable("invalid_fee");
      if (fee.currency === base) baseFee += fee.cost;
      else if (fee.currency === "USDT") quoteFee += fee.cost;
      else return unavailable("unsupported_fee_currency");
    }
    if (!Number.isFinite(baseFee) || !Number.isFinite(quoteFee)) return unavailable("invalid_fee");
    const queue = lots.get(fill.symbol) ?? [];
    lots.set(fill.symbol, queue);
    if (fill.side === "buy") {
      const quantity = fill.amount - baseFee;
      const cost = fill.costUsdt + quoteFee;
      if (quantity <= 0) return unavailable("invalid_base_fee");
      if (!Number.isFinite(cost)) return unavailable("invalid_calculation");
      queue.push({ quantity, cost });
      continue;
    }
    if (fill.side !== "sell") return unavailable("invalid_side");
    let remaining = fill.amount + baseFee;
    if (!Number.isFinite(remaining)) return unavailable("invalid_calculation");
    const required = remaining;
    const proceeds = fill.costUsdt - quoteFee;
    if (proceeds < 0) return unavailable("invalid_quote_fee");
    let basis = 0;
    while (remaining > 0 && queue.length) {
      const lot = queue[0]!;
      const used = Math.min(remaining, lot.quantity);
      const allocated = lot.cost * (used / lot.quantity);
      basis += allocated;
      const exhausted = used === lot.quantity;
      lot.quantity -= used; lot.cost -= allocated; remaining -= used;
      if (exhausted) queue.shift();
    }
    // Permit only relative floating-point residue after actually consuming inventory;
    // an absolute epsilon would falsely confirm a tiny sell without any buy.
    if (remaining > 0 && (remaining === required || remaining > required * 1e-12)) return unavailable("unmatched_sell_or_missing_history");
    pnl += proceeds - basis;
    if (!Number.isFinite(pnl)) return unavailable("invalid_calculation");
  }
  const positions: Record<string, { quantity: number; costUsdt: number }> = {};
  for (const [symbol, queue] of lots) {
    const quantity = queue.reduce((n, lot) => n + lot.quantity, 0);
    const costUsdt = queue.reduce((n, lot) => n + lot.cost, 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(costUsdt)) return unavailable("invalid_calculation");
    positions[symbol] = { quantity, costUsdt };
  }
  return { status: "confirmed", realizedPnlUsdt: pnl, positions };
}
