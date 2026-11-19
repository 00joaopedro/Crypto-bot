import { describe, expect, it } from "vitest";
import { screenEntryMarkets, symbolEntryBlock, type EntryMarket } from "../src/market-eligibility.js";
import { parseConfig } from "../src/config.js";

const options = { minQuoteVolume: 1_000_000, maxSpreadPercent: .15 };
const market = (symbol: string): EntryMarket => ({ symbol, spot: true, active: true, quote: "USDT" });
const ticker = { bid: 99.95, ask: 100.05, last: 100, quoteVolume: 2_000_000 };

describe("new entry market eligibility", () => {
  it.each(["USDC", "DAI", "FDUSD", "EURC", "USDE"])("excludes %s as base even with high volume", base => {
    const symbol = `${base}/USDT`;
    expect(screenEntryMarkets([market(symbol)], { [symbol]: ticker }, options))
      .toEqual({ eligible: [], blocked: { [symbol]: "stablecoin_base" } });
  });
  it.each(["XNVDA", "XAAPL", "NVDAx"])("classifies known tokenized equity %s", base => {
    expect(symbolEntryBlock(`${base}/USDT`)).toBe("tokenized_asset");
  });
  it("supports explicit equity metadata without excluding crypto by an X prefix", () => {
    const symbols = ["XRP/USDT", "XLM/USDT", "XMR/USDT", "ADA/USDT", "NEW/USDT"];
    const markets = symbols.map(market);
    markets[4]!.info = { assetClass: "equity" };
    const result = screenEntryMarkets(markets, Object.fromEntries(symbols.map(s => [s, ticker])), options);
    expect(result.eligible).toEqual(symbols.slice(0, 4).sort());
    expect(result.blocked).toEqual({ "NEW/USDT": "tokenized_asset" });
  });
  it("normalizes exclusions, rejects malformed configuration and permits reversal", () => {
    expect(parseConfig({ SIGNAL_EXCLUDED_SYMBOLS: " ada/usdt,ETH/USDT,ada/usdt,, " }).SIGNAL_EXCLUDED_SYMBOLS).toEqual(["ADA/USDT", "ETH/USDT"]);
    expect(() => parseConfig({ SIGNAL_EXCLUDED_SYMBOLS: "ADA-USDT" })).toThrow(/SIGNAL_EXCLUDED_SYMBOLS/);
    expect(symbolEntryBlock("ADA/USDT", { excludedSymbols: ["ADA/USDT"] })).toBe("symbol_excluded");
    expect(symbolEntryBlock("ADA/USDT", { excludedSymbols: [] })).toBeUndefined();
    expect(symbolEntryBlock("USDC/USDT", { excludeStablecoins: false })).toBeUndefined();
    expect(symbolEntryBlock("XNVDA/USDT", { excludeTokenizedAssets: false })).toBeUndefined();
    expect(parseConfig({})).toMatchObject({ SIGNAL_EXCLUDED_SYMBOLS: [], SIGNAL_EXCLUDE_STABLECOINS: true, SIGNAL_EXCLUDE_TOKENIZED_ASSETS: true, DYNAMIC_UNIVERSE_SIZE: 10 });
    expect(() => parseConfig({ DYNAMIC_UNIVERSE_SIZE: "1001" })).toThrow();
  });
  it.each([
    [{ ...ticker, bid: 0 }, "ticker_unconfirmed"],
    [{ ...ticker, ask: Number.NaN }, "ticker_unconfirmed"],
    [{ ...ticker, ask: Number.POSITIVE_INFINITY }, "ticker_unconfirmed"],
    [{ ...ticker, bid: 101 }, "crossed_spread"],
    [{ ...ticker, quoteVolume: 999_999 }, "insufficient_liquidity"],
    [{ ...ticker, quoteVolume: Number.NaN }, "insufficient_liquidity"],
    [{ ...ticker, ask: 101 }, "spread_exceeded"],
    [{}, "ticker_unconfirmed"],
  ])("rejects bad or costly tickers: %s", (input, reason) => {
    expect(screenEntryMarkets([market("BTC/USDT")], { "BTC/USDT": input }, options).blocked["BTC/USDT"]).toBe(reason);
  });
  it("screens instrument metadata and orders eligible markets by quote liquidity", () => {
    const markets = [market("BTC/USDT"), market("ETH/USDT"), { ...market("OLD/USDT"), active: false }, { ...market("BTC/USDT:USDT"), spot: false }, { ...market("BTC/EUR"), quote: "EUR" }];
    const tickers = Object.fromEntries(markets.map(m => [m.symbol, { ...ticker, quoteVolume: m.symbol === "ETH/USDT" ? 3_000_000 : 2_000_000 }]));
    expect(screenEntryMarkets(markets, tickers, options)).toEqual({ eligible: ["ETH/USDT", "BTC/USDT"], blocked: { "OLD/USDT": "market_inactive", "BTC/USDT:USDT": "not_spot", "BTC/EUR": "quote_mismatch" } });
  });
});
