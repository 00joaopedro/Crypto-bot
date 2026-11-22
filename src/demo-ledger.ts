import { Precise } from 'ccxt';

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

export type ConfirmedDemoTrade = {
  buyOrderId: string;
  openedAt: number;
  closedAt: number;
  netPnlUsdt: number;
};

export type DemoBalanceEvidence = {
  asset: string;
  expected: number;
  actual: number | null;
  source: 'bot_position' | 'baseline' | 'quote';
};

export type DemoLedgerResult =
  | { status: "unavailable"; reason: string; balanceEvidence?: DemoBalanceEvidence }
  | { status: "confirmed"; realizedPnlUsdt: number; closedTrades: ConfirmedDemoTrade[]; positions: Record<string, { quantity: number; costUsdt: number }> };

type Buy = { orderId: string; openedAt: number; openLots: number; netPnlUsdt: number };
type Lot = { quantity: Precise; cost: number; buy: Buy };

export function calculateDemoLedger(fills: DemoFill[], coverageConfirmed: boolean): DemoLedgerResult {
  const unavailable = (reason: string): DemoLedgerResult => ({ status: "unavailable", reason });
  if (!coverageConfirmed) return unavailable("execution_history_incomplete");
  const ids = new Set<string>();
  const times = new Map<string, "buy" | "sell">();
  const lots = new Map<string, Lot[]>();
  const buys = new Map<string, Buy>();
  const remainingBuyFills = new Map<string, number>();
  for (const fill of fills) {
    if (fill.side === "buy") remainingBuyFills.set(fill.orderId, (remainingBuyFills.get(fill.orderId) ?? 0) + 1);
  }
  const closedTrades: ConfirmedDemoTrade[] = [];
  let pnl = 0;
  const zero = new Precise('0');
  for (const fill of [...fills].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))) {
    const [base, quote, extra] = fill.symbol.split("/");
    if (!fill.id || !fill.orderId || ids.has(fill.id) || !base || quote !== "USDT" || extra !== undefined || !Number.isFinite(fill.timestamp) || !Number.isFinite(fill.amount) || fill.amount <= 0 || !Number.isFinite(fill.costUsdt) || fill.costUsdt <= 0 || !Array.isArray(fill.fees) || fill.fees.length === 0) return unavailable("invalid_or_incomplete_fill");
    ids.add(fill.id);
    const timeKey = `${fill.symbol}:${fill.timestamp}`;
    const previousSide = times.get(timeKey);
    if (previousSide && previousSide !== fill.side) return unavailable("ambiguous_execution_order");
    times.set(timeKey, fill.side);
    let baseFee = new Precise('0'); let quoteFee = new Precise('0');
    for (const fee of fill.fees) {
      if (!Number.isFinite(fee.cost) || fee.cost < 0) return unavailable("invalid_fee");
      if (fee.currency === base) baseFee = baseFee.add(new Precise(String(fee.cost)));
      else if (fee.currency === "USDT") quoteFee = quoteFee.add(new Precise(String(fee.cost)));
      else return unavailable("unsupported_fee_currency");
    }
    if (!Number.isFinite(Number(baseFee.toString())) || !Number.isFinite(Number(quoteFee.toString()))) return unavailable("invalid_fee");
    const queue = lots.get(fill.symbol) ?? [];
    lots.set(fill.symbol, queue);
    if (fill.side === "buy") {
      const quantity = new Precise(String(fill.amount)).sub(baseFee);
      const cost = Number(new Precise(String(fill.costUsdt)).add(quoteFee).toString());
      if (!quantity.gt(zero)) return unavailable("invalid_base_fee");
      if (!Number.isFinite(cost)) return unavailable("invalid_calculation");
      let buy = buys.get(fill.orderId);
      if (!buy) {
        buy = { orderId: fill.orderId, openedAt: fill.timestamp, openLots: 0, netPnlUsdt: 0 };
        buys.set(fill.orderId, buy);
      }
      remainingBuyFills.set(fill.orderId, remainingBuyFills.get(fill.orderId)! - 1);
      buy.openLots++;
      queue.push({ quantity, cost, buy });
      continue;
    }
    if (fill.side !== "sell") return unavailable("invalid_side");
    let remaining = new Precise(String(fill.amount)).add(baseFee);
    if (!Number.isFinite(Number(remaining.toString()))) return unavailable("invalid_calculation");
    const required = Number(remaining.toString());
    const proceeds = Number(new Precise(String(fill.costUsdt)).sub(quoteFee).toString());
    if (proceeds < 0) return unavailable("invalid_quote_fee");
    let basis = 0;
    while (remaining.gt(zero) && queue.length) {
      const lot = queue[0]!;
      const used = remaining.min(lot.quantity);
      // Keep the provider's decimal quantities exact through cancellation. An
      // actual remaining atom is inventory, not an epsilon to be written off.
      const exhausted = used.equals(lot.quantity);
      const usedNumber = Number(used.toString());
      const allocated = exhausted ? lot.cost : lot.cost * (usedNumber / Number(lot.quantity.toString()));
      basis += allocated;
      lot.quantity = lot.quantity.sub(used); lot.cost -= allocated; remaining = remaining.sub(used);
      lot.buy.netPnlUsdt += proceeds * (usedNumber / required) - allocated;
      if (!Number.isFinite(lot.buy.netPnlUsdt)) return unavailable("invalid_calculation");
      if (exhausted) {
        queue.shift();
        lot.buy.openLots--;
        if (lot.buy.openLots === 0 && remainingBuyFills.get(lot.buy.orderId) === 0) {
          closedTrades.push({ buyOrderId: lot.buy.orderId, openedAt: lot.buy.openedAt,
            closedAt: fill.timestamp, netPnlUsdt: lot.buy.netPnlUsdt });
        }
      }
    }
    // Exact decimal inventory leaves no arithmetic oversell to forgive.
    if (remaining.gt(zero)) return unavailable("unmatched_sell_or_missing_history");
    pnl += proceeds - basis;
    if (!Number.isFinite(pnl)) return unavailable("invalid_calculation");
  }
  const positions: Record<string, { quantity: number; costUsdt: number }> = {};
  for (const [symbol, queue] of lots) {
    const quantity = Number(queue.reduce((n, lot) => n.add(lot.quantity), zero).toString());
    const costUsdt = queue.reduce((n, lot) => n + lot.cost, 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(costUsdt)) return unavailable("invalid_calculation");
    positions[symbol] = { quantity, costUsdt };
  }
  return { status: "confirmed", realizedPnlUsdt: pnl, closedTrades, positions };
}
