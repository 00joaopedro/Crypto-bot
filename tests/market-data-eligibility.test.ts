import { beforeEach, expect, it, vi } from "vitest";
import { PublicMarketData } from "../src/market-data.js";

const fixtures = vi.hoisted(() => {
  const make = () => ({
    markets: Object.fromEntries(["USDC/USDT", "XNVDA/USDT", "ADA/USDT", "ETH/USDT"].map(symbol => [symbol, { symbol, spot: true, active: true, quote: "USDT" }])),
    loadMarkets: vi.fn(async () => undefined),
    fetchTickers: vi.fn(async () => Object.fromEntries(["USDC/USDT", "XNVDA/USDT", "ADA/USDT", "ETH/USDT"].map(symbol => [symbol, {
      bid: 99.99, ask: 100.01, last: 100, quoteVolume: symbol === "ADA/USDT" ? 3e6 : 2e6,
    }]))),
  });
  return { primary: make(), fallback: make() };
});
vi.mock("ccxt", () => ({ default: {
  okx: vi.fn(function () { return fixtures.primary; }),
  kraken: vi.fn(function () { return fixtures.fallback; }),
} }));
beforeEach(() => vi.clearAllMocks());

it("screens on the primary venue and applies exclusions before the discovery limit", async () => {
  const market = new PublicMarketData("okx", "kraken");
  const options = { minQuoteVolume: 1e6, maxSpreadPercent: .15 };
  expect(await market.selectSpotSymbols({ ...options, limit: 1, excludedSymbols: ["ADA/USDT"] })).toEqual(["ETH/USDT"]);
  expect(fixtures.primary.loadMarkets).toHaveBeenCalledTimes(1);
  expect(fixtures.primary.fetchTickers).toHaveBeenCalledTimes(1);
  expect(fixtures.fallback.fetchTickers).not.toHaveBeenCalled();
  // Balances/exit selectors must still see excluded assets.
  expect(market.listSpotSymbols()).toContain("USDC/USDT");
  const result = await market.screenSpotSymbols(options);
  expect(result.eligible).toEqual(["ADA/USDT", "ETH/USDT"]);
  expect(result.blocked).toMatchObject({ "USDC/USDT": "stablecoin_base", "XNVDA/USDT": "tokenized_asset" });
});
