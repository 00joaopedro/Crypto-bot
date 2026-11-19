/** Eligibility applies to NEW entries only, never to balances or exit supervision. */
export type MarketEligibilityPolicy = {
  excludedSymbols?: readonly string[];
  excludeStablecoins?: boolean;
  excludeTokenizedAssets?: boolean;
};

// Maintained classification, not a prefix heuristic: XRP, XLM and XMR are crypto.
// Unknown crypto bases remain eligible; exchanges do not provide universal categories.
const STABLE_BASES = new Set([
  "USDT", "USDC", "USD", "DAI", "FDUSD", "TUSD", "USDP", "BUSD", "USDD",
  "PYUSD", "USDE", "USD1", "RLUSD", "FRAX", "LUSD", "GUSD", "EUR", "EURC", "EURI",
]);
const TOKENIZED_BASES = new Set([
  "XNVDA", "XAAPL", "XTSLA", "XMSFT", "XAMZN", "XMETA", "XGOOGL", "XGOOG",
  "NVDAx", "AAPLx", "TSLAx", "MSFTx", "AMZNx", "METAx", "GOOGLx", "COINx",
].map(base => base.toUpperCase()));

export function normalizeSymbols(value: string): string[] {
  const symbols = [...new Set(value.split(",").map(symbol => symbol.trim().toUpperCase()).filter(Boolean))];
  if (symbols.some(symbol => !/^[A-Z0-9][A-Z0-9._-]*\/[A-Z0-9][A-Z0-9._-]*$/.test(symbol))) {
    throw new Error("Expected comma-separated Spot symbols, e.g. USDC/USDT,XNVDA/USDT");
  }
  return symbols;
}

export function symbolEntryBlock(symbol: string, policy: MarketEligibilityPolicy = {}): string | undefined {
  const normalized = symbol.toUpperCase();
  if (policy.excludedSymbols?.some(value => value.trim().toUpperCase() === normalized)) return "symbol_excluded";
  const base = normalized.split("/")[0]!;
  if (policy.excludeStablecoins !== false && STABLE_BASES.has(base)) return "stablecoin_base";
  if (policy.excludeTokenizedAssets !== false && TOKENIZED_BASES.has(base)) return "tokenized_asset";
  return undefined;
}

export type EntryMarket = {
  symbol: string;
  spot?: boolean | undefined;
  active?: boolean | undefined;
  quote?: string | undefined;
  info?: unknown;
};
export type EntryTicker = {
  bid?: number | undefined;
  ask?: number | undefined;
  last?: number | undefined;
  quoteVolume?: number | undefined;
  high?: number | undefined;
  low?: number | undefined;
};
export type MarketScreenOptions = MarketEligibilityPolicy & {
  quote?: string;
  minQuoteVolume: number;
  maxSpreadPercent: number;
};
export type MarketScreen = { eligible: string[]; blocked: Record<string, string> };

export function marketEntryBlock(market: EntryMarket, policy: MarketEligibilityPolicy = {}, quote = "USDT"): string | undefined {
  let reason = symbolEntryBlock(market.symbol, policy);
  if (!reason && !market.spot) reason = "not_spot";
  if (!reason && market.active === false) reason = "market_inactive";
  if (!reason && market.quote !== quote) reason = "quote_mismatch";
  // Only trust explicit category labels; never infer a category from an X prefix.
  const info = market.info as { assetClass?: unknown; instCategory?: unknown } | undefined;
  const category = typeof info?.assetClass === "string" ? info.assetClass.toLowerCase() : "";
  if (!reason && policy.excludeTokenizedAssets !== false && ["equity", "stock", "tokenized_stock", "tokenized_equity"].includes(category)) reason = "tokenized_asset";
  if (!reason && policy.excludeTokenizedAssets !== false && ["3", "4", "5", "6"].includes(String(info?.instCategory ?? ""))) reason = "non_crypto_asset";
  return reason;
}

export function screenEntryMarkets(
  markets: readonly EntryMarket[], tickers: Record<string, EntryTicker>, options: MarketScreenOptions,
): MarketScreen {
  const blocked: Record<string, string> = {};
  const accepted: Array<{ symbol: string; volume: number; volatility: number }> = [];
  for (const market of markets) {
    let reason = marketEntryBlock(market, options, options.quote ?? "USDT");
    const ticker = tickers[market.symbol];
    const { bid, ask, last, quoteVolume } = ticker ?? {};
    if (!reason && ![bid, ask, last].every(value => typeof value === "number" && Number.isFinite(value) && value > 0)) reason = "ticker_unconfirmed";
    if (!reason && ask! < bid!) reason = "crossed_spread";
    if (!reason && (typeof quoteVolume !== "number" || !Number.isFinite(quoteVolume) || quoteVolume < options.minQuoteVolume)) reason = "insufficient_liquidity";
    if (!reason && (ask! - bid!) / last! * 100 > options.maxSpreadPercent) reason = "spread_exceeded";
    if (reason) blocked[market.symbol] = reason;
    else {
      const volatility = Number.isFinite(ticker?.high) && Number.isFinite(ticker?.low)
        ? (ticker!.high! - ticker!.low!) / last! * 100 : 0;
      accepted.push({ symbol: market.symbol, volume: quoteVolume!, volatility });
    }
  }
  accepted.sort((a, b) => b.volume - a.volume || b.volatility - a.volatility || a.symbol.localeCompare(b.symbol));
  return { eligible: accepted.map(market => market.symbol), blocked };
}
