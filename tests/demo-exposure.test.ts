import { expect, it } from "vitest";
import { demoBotExposure } from "../src/demo-exposure.js";

const snapshot = {
  quoteCurrency: "USDT", equityUsdt: 80_000, quoteFree: 400, totalUsdt: 800,
  unvaluedAssets: [], assetUnitValuesUsdt: { BTC: 50_000, ETH: 2000 },
  freeBrlValueUsdt: 5000, updatedAt: "",
};
const positions = [{ symbol: "BTC/USDT", quantity: .001 }, { symbol: "ETH/USDT", quantity: .005 }];

it("uses the smaller allocation and values only verified bot quantities", () => {
  expect(demoBotExposure(snapshot, 5000, positions)).toMatchObject({
    equityUsdt: 80_000, tradingEquityUsdt: 460, exposureUsdt: 60, altExposureUsdt: 10,
    byAsset: new Map([["BTC", 50], ["ETH", 10]]),
  });
  expect(demoBotExposure(snapshot, 200, positions)?.tradingEquityUsdt).toBe(200);
  expect(demoBotExposure(snapshot, 5000, [])?.exposureUsdt).toBe(0);
});

it("fails closed on missing valuations, inconsistent reserves, or invalid inventory", () => {
  expect(demoBotExposure({ ...snapshot, unvaluedAssets: ["BRL"] }, 5000, [])).toBeNull();
  expect(demoBotExposure({ ...snapshot, freeBrlValueUsdt: 79_900 }, 5000, positions)).toBeNull();
  expect(demoBotExposure(snapshot, 5000, [{ symbol: "UNKNOWN/USDT", quantity: 1 }])).toBeNull();
  expect(demoBotExposure(snapshot, 5000, [{ symbol: "ETH/USDT", quantity: -1 }])).toBeNull();
});
