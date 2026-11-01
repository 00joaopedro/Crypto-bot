import type { ExchangeDemoOrder, ExchangeProtection, JournaledDemoBuy } from "./demo-ownership.js";
import type { ConfirmedDemoOrder } from "./demo-reconciliation.js";

/** These methods must belong to an already initialized OKX Demo client. */
export type OkxOrderEvidenceClient = {
  privateGetTradeOrder(params: Record<string, string>): Promise<unknown>;
  privateGetTradeOrderAlgo(params: Record<string, string>): Promise<unknown>;
};
export type CachedDemoParent = { order: ExchangeDemoOrder; evidence: ConfirmedDemoOrder };
export type OrderEvidenceResult =
  | { status: "unavailable"; reason: string }
  | { status: "collected"; buys: ExchangeDemoOrder[]; sells: ExchangeDemoOrder[]; protections: ExchangeProtection[]; orders: ConfirmedDemoOrder[]; protectionStates: Record<string, string> };

/** Fetch journaled parent orders and their attached algo and spawned orders by
 * ID. This is attribution evidence, not proof of complete history, no external
 * transactions, current balance, or P&L. Live orders retain terminal=false.
 */
export async function collectOkxDemoOrderEvidence(client: OkxOrderEvidenceClient, journal: JournaledDemoBuy[], cachedParents: CachedDemoParent[] = []): Promise<OrderEvidenceResult> {
  const unavailable = (reason: string): OrderEvidenceResult => ({ status: "unavailable", reason });
  if (!Array.isArray(journal) || journal.length === 0 || journal.length > 500) return unavailable("journal_empty_or_too_large");
  const orderIds = new Set<string>(), algoIds = new Set<string>();
  const buys: ExchangeDemoOrder[] = [], sells: ExchangeDemoOrder[] = [], protections: ExchangeProtection[] = [], orders: ConfirmedDemoOrder[] = [];
  const protectionStates: Record<string, string> = Object.create(null) as Record<string, string>;
  const one = (response: unknown): Record<string, unknown> | null => {
    if (!response || typeof response !== "object") return null;
    const payload = response as { code?: unknown; data?: unknown };
    if (payload.code !== "0" || !Array.isArray(payload.data) || payload.data.length !== 1 || !payload.data[0] || typeof payload.data[0] !== "object" || Array.isArray(payload.data[0])) return null;
    return payload.data[0] as Record<string, unknown>;
  };
  const validId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9]{1,64}$/.test(id);
  const readOrder = async (symbol: string, id: string, side: "buy" | "sell"): Promise<{ order: ExchangeDemoOrder; evidence: ConfirmedDemoOrder } | null> => {
    const instId = symbol.replace("/", "-");
    const row = one(await client.privateGetTradeOrder({ instId, ordId: id }));
    if (!row || row.instType !== "SPOT" || row.instId !== instId || row.ordId !== id || row.side !== side || typeof row.clOrdId !== "string" || typeof row.accFillSz !== "string" || !/^(?:\d+)(?:\.\d+)?$/.test(row.accFillSz)) return null;
    const filled = Number(row.accFillSz);
    if (!Number.isFinite(filled) || filled < 0 || typeof row.state !== "string" || !["live", "partially_filled", "filled", "canceled", "mmp_canceled"].includes(row.state)) return null;
    const attached: string[] = [];
    if (row.attachAlgoOrds !== undefined) {
      if (!Array.isArray(row.attachAlgoOrds)) return null;
      for (const entry of row.attachAlgoOrds) {
        if (!entry || typeof entry !== "object" || typeof (entry as Record<string, unknown>).attachAlgoClOrdId !== "string") return null;
        const idValue = (entry as Record<string, string>).attachAlgoClOrdId;
        if (idValue) attached.push(idValue);
      }
    }
    if (typeof row.attachAlgoClOrdId === "string" && row.attachAlgoClOrdId && !attached.includes(row.attachAlgoClOrdId)) attached.push(row.attachAlgoClOrdId);
    return { order: { id, symbol, side, clientOrderId: row.clOrdId || null, attachedAlgoClientIds: attached }, evidence: { id, symbol, side, filled, terminal: ["filled", "canceled", "mmp_canceled"].includes(row.state), ownershipConfirmed: false } };
  };
  try {
    for (const item of journal) {
      if (!item || !/^([A-Z0-9]+)\/USDT$/.test(item.symbol) || !validId(item.orderId) || !validId(item.clientOrderId) || !validId(item.attachedAlgoClientId) || orderIds.has(item.orderId) || algoIds.has(item.attachedAlgoClientId)) return unavailable("invalid_or_incomplete_journal");
      orderIds.add(item.orderId); algoIds.add(item.attachedAlgoClientId);
      // A terminal parent already proven in this account's checkpoint can be
      // retained beyond provider history retention. Protection is always fresh.
      const cached = cachedParents.filter(parent => parent.order?.id === item.orderId);
      if (cached.length > 1) return unavailable("duplicate_cached_parent");
      const candidate = cached[0];
      if (candidate && (candidate.order.symbol !== item.symbol || candidate.order.side !== "buy" || candidate.order.clientOrderId !== item.clientOrderId || !candidate.order.attachedAlgoClientIds?.includes(item.attachedAlgoClientId) || candidate.evidence?.id !== item.orderId || candidate.evidence.symbol !== item.symbol || candidate.evidence.side !== "buy" || candidate.evidence.terminal !== true || !Number.isFinite(candidate.evidence.filled) || candidate.evidence.filled < 0)) return unavailable("invalid_cached_parent");
      const buy = candidate ?? await readOrder(item.symbol, item.orderId, "buy");
      if (!buy || buy.order.clientOrderId !== item.clientOrderId || !buy.order.attachedAlgoClientIds?.includes(item.attachedAlgoClientId)) return unavailable("parent_order_unconfirmed");
      const row = one(await client.privateGetTradeOrderAlgo({ algoClOrdId: item.attachedAlgoClientId }));
      if (!row || row.instType !== "SPOT" || row.instId !== item.symbol.replace("/", "-") || row.algoClOrdId !== item.attachedAlgoClientId || row.side !== "sell" || !validId(row.algoId) || typeof row.state !== "string" || !["live", "effective", "canceled", "order_failed"].includes(row.state) || !Array.isArray(row.ordIdList)) return unavailable("protective_order_unconfirmed");
      const spawned: string[] = [];
      for (const id of row.ordIdList) {
        if (!validId(id) || orderIds.has(id)) return unavailable("invalid_spawned_order_ids");
        orderIds.add(id); spawned.push(id);
        const sell = await readOrder(item.symbol, id, "sell");
        if (!sell) return unavailable("spawned_order_unconfirmed");
        sells.push(sell.order); orders.push(sell.evidence);
      }
      if (row.state === "effective" && spawned.length === 0) return unavailable("effective_order_without_spawned_order");
      buys.push(buy.order); orders.push(buy.evidence);
      protections.push({ algoClientId: item.attachedAlgoClientId, symbol: item.symbol, side: "sell", spawnedOrderIds: spawned });
      protectionStates[item.attachedAlgoClientId] = row.state;
    }
    return { status: "collected", buys, sells, protections, orders, protectionStates };
  } catch { return unavailable("order_evidence_request_failed"); }
}
