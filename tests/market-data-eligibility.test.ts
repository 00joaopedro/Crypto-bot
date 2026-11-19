import { beforeEach, expect, it, vi } from "vitest";
import { PublicMarketData } from "../src/market-data.js";

const fixtures = vi.hoisted(() => {
  const make = () => ({
    markets: Object.fromEntries(["USDC/USDT", "XNVDA/USDT", "ADA/USDT", "ETH/USDT"].map(symbol => [symbol, { symbol, spot: true, active: true, quote: "USDT" }])),
    loadMarkets: vi.fn(async () => undefined),
    fetchOHLCV: vi.fn(async () => [[0, 100, 101, 99, 100, 1]]),
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


it("returns all eligible candidates for the explicit zero/all mode", async () => {
  const market = new PublicMarketData("okx");
  expect(await market.selectSpotSymbols({ limit: 0, minQuoteVolume: 1e6, maxSpreadPercent: .15 })).toEqual(["ADA/USDT", "ETH/USDT"]);
});

it("anchors concurrent scan candles without changing the active provider", async () => {
  const market = new PublicMarketData("okx", "kraken");
  await market.initialize();
  const results = await Promise.all([
    market.fetchScanCandles("ADA/USDT", 10, "okx"),
    market.fetchScanCandles("ETH/USDT", 10, "kraken"),
  ]);
  expect(results.every(candles => candles.length === 1)).toBe(true);
  expect(market.active).toBe("okx");
  expect(fixtures.primary.fetchOHLCV).toHaveBeenCalledOnce();
  expect(fixtures.fallback.fetchOHLCV).toHaveBeenCalledOnce();
});

it("makes one scan attempt without fallback amplification after a venue error", async () => {
  const market = new PublicMarketData("okx", "kraken");
  await market.initialize();
  fixtures.primary.fetchOHLCV.mockRejectedValueOnce(new Error("429"));
  await expect(market.fetchScanCandles("ADA/USDT", 10, "okx")).rejects.toThrow("429");
  expect(fixtures.primary.fetchOHLCV).toHaveBeenCalledOnce();
  expect(fixtures.fallback.fetchOHLCV).not.toHaveBeenCalled();
});
