/** Proof inputs must be read from the bot's durable journal and OKX, respectively.
 * Matching these records establishes only attribution; it does not establish
 * history coverage, execution finality, fee completeness or account isolation.
 */
export type JournaledDemoBuy = {
  orderId: string;
  clientOrderId: string;
  symbol: string;
  // Recorded at submission time, not inferred from an exchange response later.
  attachedAlgoClientId: string | null;
};

export type ExchangeDemoOrder = {
  id: string;
  clientOrderId: string | null;
  symbol: string;
  side: "buy" | "sell";
  attachedAlgoClientIds?: string[];
};

export type ExchangeProtection = {
  algoClientId: string;
  symbol: string;
  side: "buy" | "sell";
  spawnedOrderIds: string[];
};

export type OwnershipResult =
  | { status: "confirmed"; ownedOrderIds: string[] }
  | { status: "unavailable"; reason: string };

export function verifyDemoOwnership(
  journal: JournaledDemoBuy[],
  buys: ExchangeDemoOrder[],
  protections: ExchangeProtection[],
  sells: ExchangeDemoOrder[],
): OwnershipResult {
  const unavailable = (reason: string): OwnershipResult => ({ status: "unavailable", reason });
  const journalIds = new Set<string>();
  const clientIds = new Set<string>();
  const attachmentIds = new Set<string>();
  const owned = new Set<string>();
  for (const entry of journal) {
    if (!entry.orderId || !entry.clientOrderId || !entry.symbol || journalIds.has(entry.orderId) || owned.has(entry.orderId) || clientIds.has(entry.clientOrderId)) return unavailable("invalid_or_duplicate_journal");
    journalIds.add(entry.orderId);
    clientIds.add(entry.clientOrderId);
    if (!entry.attachedAlgoClientId || attachmentIds.has(entry.attachedAlgoClientId)) return unavailable("missing_or_duplicate_protection_identity");
    attachmentIds.add(entry.attachedAlgoClientId);
    const matches = buys.filter((buy) => buy.id === entry.orderId);
    if (matches.length !== 1 || matches[0]!.clientOrderId !== entry.clientOrderId || matches[0]!.symbol !== entry.symbol || matches[0]!.side !== "buy") return unavailable("buy_identity_mismatch");
    if (!matches[0]!.attachedAlgoClientIds?.includes(entry.attachedAlgoClientId)) return unavailable("parent_attachment_unconfirmed");
    owned.add(entry.orderId);
    const matchingProtection = protections.filter((protection) => protection.algoClientId === entry.attachedAlgoClientId);
    if (matchingProtection.length !== 1) return unavailable("protection_identity_unconfirmed");
    const protection = matchingProtection[0]!;
    if (protection.symbol !== entry.symbol || protection.side !== "sell" || !Array.isArray(protection.spawnedOrderIds)) return unavailable("protection_identity_mismatch");
    for (const id of protection.spawnedOrderIds) {
      if (!id || owned.has(id)) return unavailable("duplicate_spawned_order");
      const matches = sells.filter((sell) => sell.id === id);
      if (matches.length !== 1 || matches[0]!.symbol !== entry.symbol || matches[0]!.side !== "sell") return unavailable("spawned_order_unconfirmed");
      owned.add(id);
    }
  }
  // Unknown sells cannot be safely ignored: they may affect bot holdings.
  if (sells.some((sell) => !owned.has(sell.id))) return unavailable("unattributed_sell");
  return { status: "confirmed", ownedOrderIds: [...owned] };
}
